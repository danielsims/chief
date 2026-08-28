import type { UserPrincipal } from "@chief/relay-contracts";
import {
  agentConfigSchema,
  claimedWorkspaceSchema,
  claimWorkspaceCommandSchema,
  createWorkspaceCommandSchema,
  messagePageSchema,
  workspaceOnboardingResultSchema,
  workspaceSnapshotSchema,
} from "@chief/relay-contracts";

import type { readTrustedIdentity } from "./internal-context";
import type { WorkspaceRow } from "./workspace-channel-store";
import { HttpError, json, parseJson, relayError } from "./http";
import { readTrustedContext, withTrustedContext } from "./internal-context";
import { releaseInternalResponse } from "./internal-response";
import { defaultAgentConfigFor } from "./workspace-agent-config";
import { firstRow, WorkspaceChannelStore } from "./workspace-channel-store";
import {
  decodeWorkspaceSnapshot,
  defaultWorkspaceAgents,
  reconcileWorkspaceAgents,
} from "./workspace-defaults";

interface AgentKeyRow extends Record<string, SqlStorageValue> {
  agent_id: string;
  pubkey: string;
  created_at: string;
}

export class WorkspaceLifecycleService {
  private readonly channels: WorkspaceChannelStore;

  constructor(
    private readonly storage: DurableObjectStorage,
    private readonly env: Env,
  ) {
    this.channels = new WorkspaceChannelStore(storage, env);
  }

  async claim(
    request: Request,
    context: ReturnType<typeof readTrustedIdentity>,
  ) {
    if (context.identity.kind !== "user") {
      return relayError(
        403,
        "workspace_claim_denied",
        "A user identity is required to claim a workspace.",
      );
    }
    const ownerIdentity = context.identity;
    const command = claimWorkspaceCommandSchema.parse(await parseJson(request));
    if (command.workspaceId !== context.workspaceId) {
      return relayError(
        409,
        "workspace_mismatch",
        "The claim was routed to a different workspace.",
      );
    }
    if (!(await matchesBootstrapToken(command.bootstrapToken, this.env))) {
      return relayError(
        403,
        "workspace_claim_denied",
        "The workspace bootstrap token is not valid.",
      );
    }
    const createdAt = new Date().toISOString();
    const inserted = this.storage.transactionSync(() => {
      const existing = firstRow<WorkspaceRow>(
        this.storage.sql.exec("SELECT * FROM workspace WHERE singleton = 1"),
      );
      if (existing) return false;
      this.storage.sql.exec(
        `INSERT INTO workspace (
          singleton, workspace_id, name, created_at, created_by_user_id
        ) VALUES (1, ?, ?, ?, ?)`,
        command.workspaceId,
        command.name,
        createdAt,
        ownerIdentity.userId,
      );
      this.storage.sql.exec(
        `INSERT INTO members (
          principal_kind, principal_id, role, created_at
        ) VALUES ('user', ?, 'owner', ?)`,
        ownerIdentity.userId,
        createdAt,
      );
      return true;
    });
    if (!inserted) {
      return relayError(
        409,
        "workspace_already_claimed",
        "This relay workspace has already been claimed.",
      );
    }
    const principal: UserPrincipal = {
      kind: "user",
      userId: ownerIdentity.userId,
      pubkey: ownerIdentity.pubkey,
      workspaceId: context.workspaceId,
      role: "owner",
    };
    return json(
      claimedWorkspaceSchema.parse({
        workspaceId: context.workspaceId,
        name: command.name,
        createdAt,
        principal,
      }),
      { status: 201 },
    );
  }

  async createManaged(
    request: Request,
    context: ReturnType<typeof readTrustedIdentity>,
  ) {
    if (context.identity.kind !== "user") {
      return relayError(403, "user_required", "A user identity is required.");
    }
    const ownerIdentity = context.identity;
    const input = createWorkspaceCommandSchema.parse(await parseJson(request));
    const createdAt = new Date().toISOString();
    const snapshot = workspaceSnapshotSchema.parse({
      id: context.workspaceId,
      name: input.name,
      website: input.website,
      selectedApps: input.selectedApps,
      runtime: input.runtime,
      imageURL: null,
      onboardingComplete: false,
      conversations: [
        initialConversation("mission-control", "mission-control", "channel"),
        initialConversation("general", "general", "channel"),
        initialConversation("chief", "Chief", "direct"),
      ],
      agents: defaultWorkspaceAgents,
      projects: [],
      createdAt,
    });
    this.storage.transactionSync(() => {
      const existing = firstRow<WorkspaceRow>(
        this.storage.sql.exec("SELECT * FROM workspace WHERE singleton = 1"),
      );
      if (existing) return;
      this.storage.sql.exec(
        `INSERT INTO workspace (
          singleton, workspace_id, name, created_at, created_by_user_id,
          snapshot_json
        ) VALUES (1, ?, ?, ?, ?, ?)`,
        context.workspaceId,
        input.name,
        createdAt,
        ownerIdentity.userId,
        JSON.stringify(snapshot),
      );
      this.storage.sql.exec(
        `INSERT INTO members (
          principal_kind, principal_id, role, created_at
        ) VALUES ('user', ?, 'owner', ?)`,
        ownerIdentity.userId,
        createdAt,
      );
      this.channels.seedSnapshotChannels(
        snapshot,
        ownerIdentity.userId,
        createdAt,
      );
      this.channels.seedSnapshotAgents(snapshot, createdAt);
      for (const agent of snapshot.agents) {
        const config = agentConfigSchema.parse({
          ...defaultAgentConfigFor(agent.id),
          deploymentTarget: input.runtime,
          inference: {
            provider: "opencode",
            model: "opencode-go/deepseek-v4-flash",
          },
        });
        this.storage.sql.exec(
          `INSERT INTO agent_configs (agent_id, config_json, updated_at)
           VALUES (?, ?, ?)`,
          agent.id,
          JSON.stringify(config),
          createdAt,
        );
      }
    });
    return this.snapshot(context);
  }

  snapshot(context: ReturnType<typeof readTrustedIdentity>) {
    const workspace = this.channels.requireWorkspace(context.workspaceId);
    this.requireIdentityMember(context.identity);
    if (!workspace.snapshot_json) {
      return relayError(
        409,
        "workspace_snapshot_unavailable",
        "This workspace does not expose a managed snapshot.",
      );
    }
    const reconciled = reconcileWorkspaceAgents(
      decodeWorkspaceSnapshot(workspace.snapshot_json),
    );
    if (reconciled.changed) {
      this.storage.sql.exec(
        "UPDATE workspace SET snapshot_json = ? WHERE singleton = 1",
        JSON.stringify(reconciled.snapshot),
      );
    }
    return json(reconciled.snapshot);
  }

  deletionPlan(context: ReturnType<typeof readTrustedIdentity>) {
    this.requireOwner(context);
    const workspace = this.channels.requireWorkspace(context.workspaceId);
    const conversationIds = this.storage.sql
      .exec<{ conversation_id: string }>(
        "SELECT conversation_id FROM channels ORDER BY conversation_id",
      )
      .toArray()
      .map((row) => String(row.conversation_id));
    const registeredAgentIds = this.storage.sql
      .exec<{ agent_id: string }>(
        "SELECT agent_id FROM agent_keys ORDER BY agent_id",
      )
      .toArray()
      .map((row) => String(row.agent_id));
    const snapshotAgentIds = workspace.snapshot_json
      ? decodeWorkspaceSnapshot(workspace.snapshot_json).agents.map(
          (agent) => agent.id,
        )
      : [];
    return json({
      conversationIds,
      agentIds: [...new Set([...registeredAgentIds, ...snapshotAgentIds])],
    });
  }

  async deleteOwned(context: ReturnType<typeof readTrustedIdentity>) {
    this.requireOwner(context);
    await this.storage.deleteAll();
    return json({ workspaceId: context.workspaceId, deleted: true });
  }

  async completeOnboarding(request: Request) {
    const context = readTrustedContext(request);
    const workspace = this.channels.requireWorkspace(context.workspaceId);
    if (
      context.principal.kind !== "agent" ||
      context.principal.agentId !== "chief"
    ) {
      throw new HttpError(
        403,
        "chief_required",
        "Only the registered Chief agent can complete onboarding.",
      );
    }
    this.channels.requirePrincipalMember(context.principal);
    const key = firstRow<AgentKeyRow>(
      this.storage.sql.exec(
        "SELECT agent_id, pubkey, created_at FROM agent_keys WHERE agent_id = ?",
        context.principal.agentId,
      ),
    );
    // The relay's own hosted cell executes Chief inside a trusted Durable Object
    // boundary and presents the all-zero relay pubkey. It does not hold a
    // device-registered key, so it must be allowed to finalize onboarding even
    // when no key is registered. Phone/desktop cells carry a real key and must
    // still match it.
    const isHostedCell = context.principal.pubkey === "0".repeat(64);
    if (!isHostedCell && key?.pubkey !== context.principal.pubkey) {
      throw new HttpError(
        403,
        "agent_key_mismatch",
        "Chief's registered key does not match the completing identity.",
      );
    }
    if (!workspace.snapshot_json) {
      throw new HttpError(
        409,
        "workspace_snapshot_unavailable",
        "This workspace does not expose a managed snapshot.",
      );
    }
    const result = workspaceOnboardingResultSchema.parse(
      await parseJson(request),
    );
    const messages = await this.validateOnboardingDelegation(
      context,
      result.openingMessage,
    );
    const previous = reconcileWorkspaceAgents(
      decodeWorkspaceSnapshot(workspace.snapshot_json),
    ).snapshot;
    const existing = previous.conversations.find(
      (conversation) => conversation.id === "mission-control",
    );
    const missionControl = {
      ...(existing ??
        initialConversation("mission-control", "mission-control", "channel")),
      isPrivate: false,
      lastMessage: messages.at(-1)?.body ?? result.openingMessage,
    };
    const snapshot = workspaceSnapshotSchema.parse({
      ...previous,
      onboardingComplete: true,
      conversations: [
        missionControl,
        ...previous.conversations.filter(
          (conversation) => conversation.id !== "mission-control",
        ),
      ],
      agents: previous.agents.map((agent) =>
        agent.id === "chief" ? { ...agent, status: "idle" as const } : agent,
      ),
    });
    const now = new Date().toISOString();
    this.storage.transactionSync(() => {
      this.storage.sql.exec(
        "UPDATE workspace SET snapshot_json = ? WHERE singleton = 1",
        JSON.stringify(snapshot),
      );
      this.channels.seedSnapshotChannels(
        snapshot,
        workspace.created_by_user_id,
        now,
      );
      this.storage.sql.exec(
        `INSERT INTO channel_members (
          conversation_id, principal_kind, principal_id, role, joined_at
        ) VALUES ('mission-control', 'agent', 'chief', 'owner', ?)
        ON CONFLICT(conversation_id, principal_kind, principal_id) DO UPDATE
        SET role = 'owner'`,
        now,
      );
    });
    return json(snapshot);
  }

  private async validateOnboardingDelegation(
    context: ReturnType<typeof readTrustedContext>,
    openingMessage: string,
  ) {
    const requiredAgents = ["brand", "prospector", "engineer"];
    const rows = this.storage.sql
      .exec<{ principal_id: string }>(
        `SELECT principal_id FROM channel_members
         WHERE conversation_id = 'mission-control'
           AND principal_kind = 'agent'`,
      )
      .toArray();
    const members = new Set(rows.map((row) => String(row.principal_id)));
    if (!requiredAgents.every((agentId) => members.has(agentId))) {
      throw delegationIncomplete(
        "Chief must invite every kickoff agent to Mission Control before completing onboarding.",
      );
    }
    const conversation = this.env.CONVERSATIONS.get(
      this.env.CONVERSATIONS.idFromName(
        `${context.workspaceId}:mission-control`,
      ),
    );
    const response = await conversation.fetch(
      withTrustedContext(
        new Request("https://conversation.internal/messages?limit=200"),
        { ...context, conversationId: "mission-control" },
      ),
    );
    if (!response.ok) {
      await releaseInternalResponse(response);
      throw new HttpError(
        502,
        "onboarding_messages_unavailable",
        "Mission Control could not be verified.",
      );
    }
    const page = messagePageSchema.parse(await response.json());
    const messages = page.messages.filter(
      (message) =>
        message.author.kind === "agent" &&
        message.author.id === "chief" &&
        !message.threadRootId,
    );
    const bodies = messages.map((message) => message.body);
    const hasKickoff = (mention: string) =>
      bodies.some((body) =>
        body.toLocaleLowerCase().includes(`@${mention.toLocaleLowerCase()}`),
      );
    if (
      !bodies.includes(openingMessage) ||
      !hasKickoff("Marketer") ||
      !hasKickoff("Prospector") ||
      !hasKickoff("Engineer")
    ) {
      throw delegationIncomplete(
        "Chief must publish the opener and every specialist kickoff before completing onboarding.",
      );
    }
    return messages;
  }

  private requireIdentityMember(
    identity: ReturnType<typeof readTrustedIdentity>["identity"],
  ) {
    const id =
      identity.kind === "user"
        ? identity.userId
        : identity.kind === "agent"
          ? identity.agentId
          : identity.service;
    const role = this.channels.memberRole(identity.kind, id);
    if (!role) {
      throw new HttpError(
        403,
        "workspace_access_denied",
        "This identity is not a workspace member.",
      );
    }
  }

  private requireOwner(context: ReturnType<typeof readTrustedIdentity>) {
    if (context.identity.kind !== "user") {
      throw new HttpError(
        403,
        "owner_required",
        "A workspace owner is required.",
      );
    }
    const role = this.channels.memberRole("user", context.identity.userId);
    if (role !== "owner") {
      throw new HttpError(
        403,
        "owner_required",
        "Only a workspace owner can delete this workspace.",
      );
    }
  }
}

function initialConversation(
  id: string,
  name: string,
  kind: "channel" | "direct",
) {
  return {
    id,
    name,
    kind,
    isPrivate: kind === "direct",
    unreadCount: 0,
    requiresAttention: false,
    lastMessage: null,
  };
}

function delegationIncomplete(message: string) {
  return new HttpError(409, "onboarding_delegation_incomplete", message);
}

async function matchesBootstrapToken(token: string, env: Env) {
  const actual = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)),
  );
  const expected = hexBytes(env.BOOTSTRAP_TOKEN_SHA256);
  if (actual.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < actual.length; index += 1) {
    difference |= (actual[index] ?? 0) ^ (expected[index] ?? 0);
  }
  return difference === 0;
}

function hexBytes(value: string) {
  if (!/^[0-9a-f]{64}$/iu.test(value)) return new Uint8Array();
  return Uint8Array.from(value.match(/.{2}/gu) ?? [], (byte) =>
    Number.parseInt(byte, 16),
  );
}
