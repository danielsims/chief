import type { UserPrincipal } from "@chief/relay-contracts";
import {
  agentConfigSchema,
  claimedWorkspaceSchema,
  claimWorkspaceCommandSchema,
  provisionWorkspaceCommandSchema,
  workspaceSnapshotSchema,
} from "@chief/relay-contracts";

import type { readTrustedIdentity } from "./internal-context";
import type { WorkspaceRow } from "./workspace-channel-store";
import { HttpError, json, parseJson, relayError } from "./http";
import { agentConfigsInsertCreateManaged } from "./queries/agent-configs/insert-create-managed";
import { agentKeysFindDeletionPlan } from "./queries/agent-keys/find-deletion-plan";
import { channelsFindDeletionPlan } from "./queries/channels/find-deletion-plan";
import { membersInsertClaimRow } from "./queries/members/insert-claim-row";
import { workspaceFindAuthorize } from "./queries/workspace/find-authorize";
import { workspaceInsertClaim } from "./queries/workspace/insert-claim";
import { workspaceInsertCreateManaged } from "./queries/workspace/insert-create-managed";
import { workspaceUpdateVerifyConnection } from "./queries/workspace/update-verify-connection";
import { defaultAgentConfigFor } from "./workspace-agent-config";
import { canMessageAgent } from "./workspace-agent-messaging";
import { firstRow, WorkspaceChannelStore } from "./workspace-channel-store";
import {
  decodeWorkspaceSnapshot,
  workspaceAgentProfiles,
} from "./workspace-defaults";
import {
  externalAgentSnapshotRows,
  reconcileExternalAgentSnapshot,
} from "./workspace-external-agent-snapshot";
import {
  initialConversation,
  matchesBootstrapToken,
  workspaceInference,
} from "./workspace-lifecycle-support";
import { WorkspaceLiveStore } from "./workspace-live-store";
import { onboardingRoster } from "./workspace-onboarding-roster";
import { WorkspaceSecretStore } from "./workspace-secret-store";

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
        workspaceFindAuthorize(this.storage),
      );
      if (existing) return false;
      workspaceInsertClaim(this.storage, {
        workspaceId: command.workspaceId,
        name: command.name,
        createdAt: createdAt,
        createdByUserId: ownerIdentity.userId,
      });
      membersInsertClaimRow(this.storage, ownerIdentity.userId, createdAt);
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
    const provision = provisionWorkspaceCommandSchema.parse(
      await parseJson(request),
    );
    const input = provision.workspace;
    const secretStore = new WorkspaceSecretStore(
      this.storage,
      this.env.RELAY_SECRET_KEY,
    );
    const inference =
      input.runtime === "desktop"
        ? {
            provider:
              input.localProvider === "claude"
                ? ("claude" as const)
                : input.localProvider === "codex"
                  ? ("codex" as const)
                  : ("opencode" as const),
            model: "auto",
            secretRef: "opencode",
          }
        : workspaceInference(provision.workspace.inferenceProvider);
    const credential =
      inference.provider === "vercel-ai-gateway"
        ? provision.secrets.vercelAiGateway
        : provision.secrets.opencode;
    const preparedSecret = credential
      ? await secretStore.prepare(
          context.workspaceId,
          inference.secretRef,
          credential,
        )
      : null;
    const createdAt = new Date().toISOString();
    const snapshot = workspaceSnapshotSchema.parse({
      id: context.workspaceId,
      name: input.name,
      website: input.website,
      slug: input.slug,
      purpose: input.purpose,
      companyName: input.companyName,
      setupComplete: false,
      selectedApps: input.selectedApps,
      runtime: input.agentRuntime === "relay-cell" ? input.runtime : null,
      imageURL: null,
      onboardingComplete: false,
      conversations: [initialConversation("general", "general", "channel")],
      agents: onboardingRoster(input),
      projects: [],
      createdAt,
    });
    this.storage.transactionSync(() => {
      const existing = firstRow<WorkspaceRow>(
        workspaceFindAuthorize(this.storage),
      );
      if (existing) {
        if (preparedSecret) secretStore.writePrepared(preparedSecret);
        return;
      }
      workspaceInsertCreateManaged(this.storage, {
        workspaceId: context.workspaceId,
        name: input.name,
        createdAt: createdAt,
        createdByUserId: ownerIdentity.userId,
        snapshotJson: JSON.stringify(snapshot),
      });
      membersInsertClaimRow(this.storage, ownerIdentity.userId, createdAt);
      this.channels.seedSnapshotChannels(
        snapshot,
        ownerIdentity.userId,
        createdAt,
      );
      this.channels.seedSnapshotAgents(snapshot, createdAt);
      for (const agent of workspaceAgentProfiles(snapshot)) {
        const config = agentConfigSchema.parse({
          ...defaultAgentConfigFor(agent.id),
          // Setup enables the team once the owner's Chief is ready.
          enabled: false,
          deploymentTarget: input.runtime,
          inference: preparedSecret
            ? {
                provider: inference.provider,
                model: inference.model,
                secretRef: inference.secretRef,
              }
            : {
                provider: inference.provider,
                model: inference.model,
              },
        });
        agentConfigsInsertCreateManaged(this.storage, {
          agentId: agent.id,
          configJson: JSON.stringify(config),
          updatedAt: createdAt,
        });
      }
      if (preparedSecret) secretStore.writePrepared(preparedSecret);
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
    const { snapshot } = reconcileExternalAgentSnapshot(
      decodeWorkspaceSnapshot(workspace.snapshot_json),
      externalAgentSnapshotRows(this.storage),
    );
    const nextSnapshot = JSON.stringify(snapshot);
    if (nextSnapshot !== workspace.snapshot_json)
      workspaceUpdateVerifyConnection(this.storage, nextSnapshot);
    const lastMessageTimes = new WorkspaceLiveStore(
      this.storage,
    ).lastMessageTimes();
    const conversations = snapshot.conversations.map((conversation) => {
      const lastMessageAt = lastMessageTimes.get(conversation.id);
      return lastMessageAt ? { ...conversation, lastMessageAt } : conversation;
    });
    if (context.identity.kind !== "user")
      return json({ ...snapshot, conversations });
    const principal: UserPrincipal = {
      role: "member",
      kind: "user",
      userId: context.identity.userId,
      pubkey: context.identity.pubkey,
      workspaceId: context.workspaceId,
    };
    const names = this.channels.principalNames();
    return json({
      ...snapshot,
      // Each person sees only the DMs they are in. A person-to-person DM is
      // named after the other participant, for this viewer.
      conversations: conversations.flatMap((conversation) => {
        if (conversation.kind !== "direct") return [conversation];
        const members = this.channels.channelMemberRows(conversation.id, names);
        if (
          !members.some(
            (member) =>
              member.kind === "user" && member.principalId === principal.userId,
          )
        )
          return [];
        const agent = members.find((member) => member.kind === "agent");
        if (agent)
          return [{ ...conversation, directAgentId: agent.principalId }];
        if (members.some((member) => member.kind !== "user"))
          return [conversation];
        const peer = members.find(
          (member) => member.principalId !== principal.userId,
        );
        if (!peer) return [];
        return [
          {
            ...conversation,
            name: (
              names.get(`user:${peer.principalId}`) ?? conversation.name
            ).slice(0, 120),
            directUserId: peer.principalId,
          },
        ];
      }),
      agents: snapshot.agents.map((agent) => ({
        ...agent,
        ...this.agentProvider(agent),
        canRunOnDevice:
          (agent.ownerUserId ?? workspace.created_by_user_id) ===
          principal.userId,
        canMessage: canMessageAgent(this.channels, agent.id, principal),
        subagents: agent.subagents.map((child) => ({
          ...child,
          ...this.agentProvider({ ...child, runtime: agent.runtime }),
          canMessage: canMessageAgent(this.channels, child.id, principal),
        })),
      })),
    });
  }

  deletionPlan(context: ReturnType<typeof readTrustedIdentity>) {
    this.requireOwner(context);
    const workspace = this.channels.requireWorkspace(context.workspaceId);
    const conversationIds = channelsFindDeletionPlan<{
      conversation_id: string;
    }>(this.storage).map((row) => String(row.conversation_id));
    const registeredAgentIds = agentKeysFindDeletionPlan<{ agent_id: string }>(
      this.storage,
    ).map((row) => String(row.agent_id));
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

  /** A Chief-run agent's provider name, which every member may see. */
  private agentProvider(agent: { id: string; runtime: { kind: string } }): {
    provider?: string;
  } {
    return agent.runtime.kind === "native-cell"
      ? {
          provider: this.channels.agentConfiguration(agent.id).inference
            .provider,
        }
      : {};
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
