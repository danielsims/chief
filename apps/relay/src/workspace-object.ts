import { DurableObject } from "cloudflare:workers";

import type {
  AuthenticatedIdentity,
  Principal,
  UserPrincipal,
  WorkspaceSnapshot,
} from "@chief/relay-contracts";
import {
  agentConfigSchema,
  agentIdSchema,
  appendMessageCommandSchema,
  channelActionResultSchema,
  channelArchiveCommandSchema,
  channelCreateCommandSchema,
  channelDetailSchema,
  channelJoinCommandSchema,
  channelLeaveCommandSchema,
  channelListResultSchema,
  channelMemberAddCommandSchema,
  channelMemberRemoveCommandSchema,
  channelMembersResultSchema,
  channelRecordSchema,
  channelUnarchiveCommandSchema,
  channelUpdateCommandSchema,
  claimedWorkspaceSchema,
  claimWorkspaceCommandSchema,
  commandIdSchema,
  conversationIdSchema,
  createWorkspaceCommandSchema,
  defaultAgentConfig,
  directStartCommandSchema,
  directStartResultSchema,
  hexPubkeySchema,
  isoDateTimeSchema,
  logBatchSchema,
  messageIdSchema,
  messagePageSchema,
  principalSchema,
  registerAgentKeyCommandSchema,
  workspaceIdSchema,
  workspaceOnboardingResultSchema,
  workspaceSnapshotSchema,
} from "@chief/relay-contracts";

import { HttpError, json, parseJson, relayError } from "./http";
import {
  readTrustedContext,
  readTrustedIdentity,
  withTrustedContext,
} from "./internal-context";
import { recordMetrics } from "./metrics";
import {
  initializeWorkspaceData,
  routeWorkspaceData,
} from "./workspace-data-store";
import {
  defaultWorkspaceAgents,
  reconcileWorkspaceAgents,
} from "./workspace-defaults";
import {
  appendWorkspaceLogs,
  initializeWorkspaceLog,
  readWorkspaceLogs,
} from "./workspace-log-store";

interface MemberRow extends Record<string, SqlStorageValue> {
  principal_kind: AuthenticatedIdentity["kind"];
  principal_id: string;
  role: "owner" | "admin" | "member";
}

interface AgentKeyRow extends Record<string, SqlStorageValue> {
  agent_id: string;
  pubkey: string;
  created_at: string;
}

interface AgentConfigRow extends Record<string, SqlStorageValue> {
  agent_id: string;
  config_json: string;
  updated_at: string;
}

interface ChannelRow extends Record<string, SqlStorageValue> {
  conversation_id: string;
  workspace_id: string;
  name: string;
  kind: "channel" | "direct";
  is_private: number;
  archived: number;
  description: string | null;
  created_by_kind: string;
  created_by_id: string;
  version: number;
  created_at: string;
  updated_at: string;
}

interface ChannelMemberRow extends Record<string, SqlStorageValue> {
  conversation_id: string;
  principal_kind: "user" | "agent";
  principal_id: string;
  role: "owner" | "admin" | "member";
  joined_at: string;
}

interface ChannelMembershipBatchRow extends Record<string, SqlStorageValue> {
  command_id: string;
  conversation_id: string;
  event_json: string;
  published: number;
}

interface PendingChannelMembershipBatchEvent {
  commandId: string;
  messageId: string;
  actor: Principal;
  targets: Array<{
    kind: "user" | "agent";
    id: string;
    name: string;
  }>;
  occurredAt: string;
}

interface WorkspaceRow extends Record<string, SqlStorageValue> {
  workspace_id: string;
  name: string;
  created_at: string;
  created_by_user_id: string;
  snapshot_json: string | null;
}

export class WorkspaceObject extends DurableObject<Env> {
  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    void state.blockConcurrencyWhile(() => {
      state.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS workspace (
          singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
          workspace_id TEXT NOT NULL UNIQUE,
          name TEXT NOT NULL,
          created_at TEXT NOT NULL,
          created_by_user_id TEXT NOT NULL,
          snapshot_json TEXT
        );
        CREATE TABLE IF NOT EXISTS members (
          principal_kind TEXT NOT NULL,
          principal_id TEXT NOT NULL,
          role TEXT NOT NULL,
          created_at TEXT NOT NULL,
          PRIMARY KEY (principal_kind, principal_id)
        );
        CREATE TABLE IF NOT EXISTS agent_keys (
          agent_id TEXT PRIMARY KEY,
          pubkey TEXT NOT NULL UNIQUE,
          created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS channels (
          conversation_id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL,
          name TEXT NOT NULL,
          kind TEXT NOT NULL DEFAULT 'channel',
          is_private INTEGER NOT NULL DEFAULT 0,
          archived INTEGER NOT NULL DEFAULT 0,
          description TEXT,
          created_by_kind TEXT NOT NULL,
          created_by_id TEXT NOT NULL,
          version INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS channel_members (
          conversation_id TEXT NOT NULL,
          principal_kind TEXT NOT NULL,
          principal_id TEXT NOT NULL,
          role TEXT NOT NULL,
          joined_at TEXT NOT NULL,
          PRIMARY KEY (conversation_id, principal_kind, principal_id)
        );
        CREATE INDEX IF NOT EXISTS channels_workspace_idx
          ON channels (workspace_id);
        CREATE INDEX IF NOT EXISTS channel_members_ctable_idx
          ON channel_members (conversation_id);
        CREATE TABLE IF NOT EXISTS channel_membership_events (
          conversation_id TEXT NOT NULL,
          principal_kind TEXT NOT NULL,
          principal_id TEXT NOT NULL,
          event_json TEXT NOT NULL,
          published INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (conversation_id, principal_kind, principal_id)
        );
        CREATE TABLE IF NOT EXISTS channel_membership_batches (
          command_id TEXT PRIMARY KEY,
          conversation_id TEXT NOT NULL,
          event_json TEXT NOT NULL,
          published INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS agent_configs (
          agent_id TEXT PRIMARY KEY,
          config_json TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS policy (
          key TEXT PRIMARY KEY,
          value_json TEXT NOT NULL
        );
      `);
      const channelColumns = state.storage.sql
        .exec<Record<string, SqlStorageValue>>("PRAGMA table_info(channels)")
        .toArray();
      if (!channelColumns.some((column) => column.name === "kind")) {
        state.storage.sql.exec(
          "ALTER TABLE channels ADD COLUMN kind TEXT NOT NULL DEFAULT 'channel'",
        );
      }
      this.ensureSnapshotChannels();
      state.storage.sql.exec(
        "UPDATE channels SET is_private = 0 WHERE conversation_id = 'mission-control'",
      );
      initializeWorkspaceLog(state.storage);
      initializeWorkspaceData(state.storage);
      return Promise.resolve();
    });
  }

  async fetch(request: Request) {
    try {
      const operation = request.headers.get("x-chief-internal-operation");
      if (request.method !== "POST") {
        return relayError(405, "method_not_allowed", "Method not allowed.");
      }
      if (operation?.startsWith("channels-")) {
        return await this.channel(request, operation);
      }
      if (operation === "directs-start") {
        return await this.directsStart(request);
      }
      if (operation === "members-list") {
        return this.membersList(request);
      }
      if (operation === "agent-config-get") {
        return this.agentConfigGet(request);
      }
      if (operation === "agent-config-set") {
        return await this.agentConfigSet(request);
      }
      if (operation?.startsWith("data-")) {
        const context = readTrustedContext(request);
        this.requirePrincipalMember(context.principal);
        this.requireAgentCapability(
          context.principal,
          workspaceDataCapability(operation),
        );
        const response = await routeWorkspaceData(
          this.ctx.storage,
          request,
          operation,
          context.principal,
        );
        if (response) return response;
      }
      if (operation === "authorize-conversation") {
        return this.authorizeConversation(request);
      }
      if (operation === "authorize-agent-runtime") {
        return this.authorizeAgentRuntime(request);
      }
      if (operation === "complete-onboarding") {
        return await this.completeOnboarding(request);
      }
      const context = readTrustedIdentity(request);
      if (operation === "authorize") {
        return this.authorize(context.identity);
      }
      if (operation === "claim") {
        return await this.claim(request, context);
      }
      if (operation === "create-managed") {
        return await this.createManaged(request, context);
      }
      if (operation === "snapshot") {
        return this.snapshot(context);
      }
      if (operation === "record-logs") {
        return await this.recordLogs(request);
      }
      if (operation === "list-logs") {
        return this.listLogs(request);
      }
      if (operation === "register-agent-key") {
        return await this.registerAgentKey(request, context);
      }
      if (operation === "agent-keys") {
        return this.agentKeys();
      }
      return relayError(404, "not_found", "Workspace operation not found.");
    } catch (error) {
      if (error instanceof HttpError) {
        return relayError(error.status, error.code, error.message);
      }
      return relayError(
        400,
        "invalid_request",
        "The workspace request is invalid.",
      );
    }
  }

  private authorize(identity: AuthenticatedIdentity) {
    // A pubkey may be an agent: if the authenticated key matches a registered
    // agent key, the agent acts on its own identity (no owner impersonation).
    const agent =
      identity.kind === "user"
        ? firstRow<AgentKeyRow>(
            this.ctx.storage.sql.exec(
              "SELECT agent_id, pubkey, created_at FROM agent_keys WHERE pubkey = ?",
              identity.pubkey,
            ),
          )
        : undefined;
    const kind = agent ? "agent" : "user";
    const principalId = agent ? agent.agent_id : identityId(identity);
    const member = firstRow<MemberRow>(
      this.ctx.storage.sql.exec(
        `SELECT principal_kind, principal_id, role FROM members
         WHERE principal_kind = ? AND principal_id = ?`,
        kind,
        principalId,
      ),
    );
    const workspace = firstRow<WorkspaceRow>(
      this.ctx.storage.sql.exec("SELECT * FROM workspace WHERE singleton = 1"),
    );
    if (!member || !workspace) {
      return relayError(
        403,
        "workspace_access_denied",
        "This identity is not a workspace member.",
      );
    }
    const resolved: AuthenticatedIdentity = agent
      ? {
          kind: "agent",
          agentId: agentIdSchema.parse(agent.agent_id),
          pubkey: hexPubkeySchema.parse(agent.pubkey),
        }
      : identity;
    return json({ principal: toPrincipal(resolved, member, workspace) });
  }

  private async registerAgentKey(
    request: Request,
    context: ReturnType<typeof readTrustedIdentity>,
  ) {
    if (context.identity.kind !== "user") {
      return relayError(
        403,
        "user_required",
        "A user identity is required to register an agent key.",
      );
    }
    const owner = this.memberRole("user", context.identity.userId);
    if (owner !== "owner") {
      return relayError(
        403,
        "owner_required",
        "Only a workspace owner can register agent keys.",
      );
    }
    const input = registerAgentKeyCommandSchema.parse(await parseJson(request));
    const existingAgent = firstRow<AgentKeyRow>(
      this.ctx.storage.sql.exec(
        "SELECT agent_id, pubkey, created_at FROM agent_keys WHERE agent_id = ?",
        input.agentId,
      ),
    );
    const existingKey = firstRow<AgentKeyRow>(
      this.ctx.storage.sql.exec(
        "SELECT agent_id, pubkey, created_at FROM agent_keys WHERE pubkey = ?",
        input.pubkey,
      ),
    );
    if (existingAgent && existingAgent.pubkey !== input.pubkey) {
      throw new HttpError(
        409,
        "agent_key_already_registered",
        "This agent already has a registered key. Use an explicit key rotation flow.",
      );
    }
    if (existingKey && existingKey.agent_id !== input.agentId) {
      throw new HttpError(
        409,
        "agent_key_reuse_denied",
        "An agent key cannot be shared by multiple agents.",
      );
    }
    if (existingAgent) {
      return json({ agentId: input.agentId, pubkey: input.pubkey });
    }
    const createdAt = new Date().toISOString();
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        `INSERT INTO agent_keys (agent_id, pubkey, created_at)
         VALUES (?, ?, ?)`,
        input.agentId,
        input.pubkey,
        createdAt,
      );
      // Agents are equals: registering a key also grants workspace membership.
      this.ctx.storage.sql.exec(
        `INSERT INTO members (principal_kind, principal_id, role, created_at)
         VALUES ('agent', ?, 'member', ?)
         ON CONFLICT(principal_kind, principal_id) DO NOTHING`,
        input.agentId,
        createdAt,
      );
      this.ctx.storage.sql.exec(
        `INSERT INTO channel_members (
          conversation_id, principal_kind, principal_id, role, joined_at
        ) SELECT conversation_id, 'agent', ?, 'member', ? FROM channels
          WHERE conversation_id = ?
        ON CONFLICT(conversation_id, principal_kind, principal_id) DO NOTHING`,
        input.agentId,
        createdAt,
        input.agentId,
      );
      if (input.agentId === "chief") {
        this.ctx.storage.sql.exec(
          `INSERT INTO channel_members (
            conversation_id, principal_kind, principal_id, role, joined_at
          ) VALUES ('mission-control', 'agent', 'chief', 'owner', ?)
          ON CONFLICT(conversation_id, principal_kind, principal_id) DO UPDATE
          SET role = 'owner'`,
          createdAt,
        );
      }
    });
    recordMetrics(this.env, ["agent-created"]);
    return json({ agentId: input.agentId, pubkey: input.pubkey });
  }

  private agentKeys() {
    const rows = this.ctx.storage.sql
      .exec("SELECT agent_id, pubkey FROM agent_keys ORDER BY agent_id")
      .toArray() as AgentKeyRow[];
    return json({
      agents: rows.map((row) => ({
        agentId: agentIdSchema.parse(String(row.agent_id)),
        pubkey: hexPubkeySchema.parse(String(row.pubkey)),
      })),
    });
  }

  private membersList(request: Request) {
    const context = readTrustedContext(request);
    this.requirePrincipalMember(context.principal);
    this.requireAgentCapability(context.principal, "workspace");
    const rows = this.ctx.storage.sql
      .exec(
        "SELECT principal_kind, principal_id, role FROM members ORDER BY principal_kind, principal_id",
      )
      .toArray() as MemberRow[];
    return json({
      members: rows.map((row) => ({
        kind: row.principal_kind,
        principalId: row.principal_id,
        role: row.role,
      })),
    });
  }

  private agentConfigGet(request: Request) {
    const context = readTrustedContext(request);
    this.requireAgentConfigAccess(context.principal, false);
    const agentId = new URL(request.url).searchParams.get("agentId");
    if (!agentId) {
      throw new HttpError(400, "missing_agent", "An agentId is required.");
    }
    const row = firstRow<AgentConfigRow>(
      this.ctx.storage.sql.exec(
        "SELECT agent_id, config_json, updated_at FROM agent_configs WHERE agent_id = ?",
        agentId,
      ),
    );
    if (!row) return json(null);
    const config = agentConfigSchema.parse(JSON.parse(row.config_json));
    return json({
      agentId: agentIdSchema.parse(row.agent_id),
      config,
      updatedAt: row.updated_at,
    });
  }

  private async agentConfigSet(request: Request) {
    const context = readTrustedContext(request);
    this.requireAgentConfigAccess(context.principal, true);
    const input = (await parseJson(request)) as {
      agentId?: unknown;
      config?: unknown;
    };
    const agentId = agentIdSchema.parse(input.agentId);
    const parsedConfig = agentConfigSchema.parse(input.config);
    const config = JSON.stringify(parsedConfig);
    const updatedAt = new Date().toISOString();
    this.ctx.storage.sql.exec(
      `INSERT INTO agent_configs (agent_id, config_json, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(agent_id) DO UPDATE SET config_json = excluded.config_json,
         updated_at = excluded.updated_at`,
      agentId,
      config,
      updatedAt,
    );
    return json({
      agentId,
      config: JSON.parse(config) as unknown,
      updatedAt,
    });
  }

  private requireAgentConfigAccess(principal: Principal, write: boolean) {
    const member = this.requirePrincipalMember(principal);
    if (
      principal.kind !== "user" ||
      (member.role !== "owner" && member.role !== "admin")
    ) {
      throw new HttpError(
        403,
        write ? "agent_config_write_denied" : "agent_config_read_denied",
        "Only a workspace owner or admin can manage agent configuration.",
      );
    }
  }

  private authorizeConversation(request: Request) {
    const context = readTrustedContext(request);
    this.requirePrincipalMember(context.principal);
    this.requireAgentCapability(context.principal, "messages");
    const conversationId = parseChannelId(
      new URL(request.url).searchParams.get("conversationId"),
    );
    this.requireChannelVisible(conversationId, context.principal);
    return json({ ok: true });
  }

  private authorizeAgentRuntime(request: Request) {
    const context = readTrustedContext(request);
    this.requirePrincipalMember(context.principal);
    if (context.principal.kind !== "agent") {
      throw new HttpError(
        403,
        "agent_required",
        "An agent identity is required for agent runtime access.",
      );
    }
    const config = this.agentConfiguration(context.principal.agentId);
    if (!config.enabled) {
      throw new HttpError(
        403,
        "agent_disabled",
        "This agent is disabled by workspace policy.",
      );
    }
    return json({ ok: true });
  }

  private async claim(
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
    const inserted = this.ctx.storage.transactionSync(() => {
      const existing = firstRow<WorkspaceRow>(
        this.ctx.storage.sql.exec(
          "SELECT * FROM workspace WHERE singleton = 1",
        ),
      );
      if (existing) return false;
      this.ctx.storage.sql.exec(
        `INSERT INTO workspace (
          singleton, workspace_id, name, created_at, created_by_user_id
        ) VALUES (1, ?, ?, ?, ?)`,
        command.workspaceId,
        command.name,
        createdAt,
        ownerIdentity.userId,
      );
      this.ctx.storage.sql.exec(
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

  private async createManaged(
    request: Request,
    context: ReturnType<typeof readTrustedIdentity>,
  ) {
    if (context.identity.kind !== "user") {
      return relayError(403, "user_required", "A user identity is required.");
    }
    const ownerId = context.identity.userId;
    const input = createWorkspaceCommandSchema.parse(await parseJson(request));
    const createdAt = new Date().toISOString();
    const snapshot = workspaceSnapshotSchema.parse({
      id: context.workspaceId,
      name: input.name,
      website: input.website,
      selectedApps: input.selectedApps,
      imageURL: null,
      onboardingComplete: false,
      conversations: [
        {
          id: "mission-control",
          name: "mission-control",
          kind: "channel",
          isPrivate: false,
          unreadCount: 0,
          requiresAttention: false,
          lastMessage: null,
        },
        {
          id: "general",
          name: "general",
          kind: "channel",
          isPrivate: false,
          unreadCount: 0,
          requiresAttention: false,
          lastMessage: null,
        },
        {
          id: "chief",
          name: "Chief",
          kind: "direct",
          isPrivate: true,
          unreadCount: 0,
          requiresAttention: false,
          lastMessage: null,
        },
      ],
      agents: defaultWorkspaceAgents,
      projects: [],
      createdAt,
    });
    this.ctx.storage.transactionSync(() => {
      const existing = firstRow<WorkspaceRow>(
        this.ctx.storage.sql.exec(
          "SELECT * FROM workspace WHERE singleton = 1",
        ),
      );
      if (existing) return;
      this.ctx.storage.sql.exec(
        `INSERT INTO workspace (
          singleton, workspace_id, name, created_at, created_by_user_id,
          snapshot_json
        ) VALUES (1, ?, ?, ?, ?, ?)`,
        context.workspaceId,
        input.name,
        createdAt,
        ownerId,
        JSON.stringify(snapshot),
      );
      this.ctx.storage.sql.exec(
        `INSERT INTO members (
          principal_kind, principal_id, role, created_at
        ) VALUES ('user', ?, 'owner', ?)`,
        ownerId,
        createdAt,
      );
      this.seedSnapshotChannels(snapshot, ownerId, createdAt);
    });
    return this.snapshot(context);
  }

  private snapshot(context: ReturnType<typeof readTrustedIdentity>) {
    const workspace = this.requireWorkspace(context.workspaceId);
    this.requireMember(context.identity);
    if (!workspace.snapshot_json) {
      return relayError(
        409,
        "workspace_snapshot_unavailable",
        "This workspace does not expose a managed snapshot.",
      );
    }
    const parsed = workspaceSnapshotSchema.parse(
      JSON.parse(workspace.snapshot_json),
    );
    const reconciled = reconcileWorkspaceAgents(parsed);
    if (reconciled.changed) {
      this.ctx.storage.sql.exec(
        "UPDATE workspace SET snapshot_json = ? WHERE singleton = 1",
        JSON.stringify(reconciled.snapshot),
      );
    }
    return json(reconciled.snapshot);
  }

  private async completeOnboarding(request: Request) {
    const context = readTrustedContext(request);
    const workspace = this.requireWorkspace(context.workspaceId);
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
    this.requirePrincipalMember(context.principal);
    const key = firstRow<AgentKeyRow>(
      this.ctx.storage.sql.exec(
        "SELECT agent_id, pubkey, created_at FROM agent_keys WHERE agent_id = ?",
        context.principal.agentId,
      ),
    );
    if (key?.pubkey !== context.principal.pubkey) {
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
    const missionControlMessages = await this.validateOnboardingDelegation(
      context,
      result.openingMessage,
    );
    const previous = reconcileWorkspaceAgents(
      workspaceSnapshotSchema.parse(JSON.parse(workspace.snapshot_json)),
    ).snapshot;
    const existingMissionControl = previous.conversations.find(
      (conversation) => conversation.id === "mission-control",
    );
    const missionControl = {
      ...(existingMissionControl ?? {
        id: "mission-control",
        name: "mission-control",
        kind: "channel" as const,
        isPrivate: false,
        unreadCount: 1,
        requiresAttention: false,
      }),
      isPrivate: false,
      lastMessage: missionControlMessages.at(-1)?.body ?? result.openingMessage,
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
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        "UPDATE workspace SET snapshot_json = ? WHERE singleton = 1",
        JSON.stringify(snapshot),
      );
      this.seedSnapshotChannels(snapshot, workspace.created_by_user_id, now);
      this.ctx.storage.sql.exec(
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

  /** Chief's completion is accepted only after the canonical relay state shows
   * the real delegation. Model-emitted tool metadata is never treated as proof. */
  private async validateOnboardingDelegation(
    context: ReturnType<typeof readTrustedContext>,
    openingMessage: string,
  ) {
    const requiredAgents = ["brand", "prospector", "engineer"];
    const memberRows = this.ctx.storage.sql
      .exec<{ principal_id: string }>(
        `SELECT principal_id FROM channel_members
         WHERE conversation_id = 'mission-control'
           AND principal_kind = 'agent'`,
      )
      .toArray();
    const members = new Set(memberRows.map((row) => String(row.principal_id)));
    if (!requiredAgents.every((agentId) => members.has(agentId))) {
      throw new HttpError(
        409,
        "onboarding_delegation_incomplete",
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
        {
          ...context,
          conversationId: "mission-control",
        },
      ),
    );
    if (!response.ok) {
      throw new HttpError(
        502,
        "onboarding_messages_unavailable",
        "Mission Control could not be verified.",
      );
    }
    const page = messagePageSchema.parse(await response.json());
    const chiefMessages = page.messages.filter(
      (message) =>
        message.author.kind === "agent" &&
        message.author.id === "chief" &&
        !message.threadRootId,
    );
    const bodies = chiefMessages.map((message) => message.body);
    const hasOpening = bodies.includes(openingMessage);
    const hasKickoff = (mention: string) =>
      bodies.some((body) =>
        body.toLocaleLowerCase().includes(`@${mention.toLocaleLowerCase()}`),
      );
    if (
      !hasOpening ||
      !hasKickoff("Marketer") ||
      !hasKickoff("Prospector") ||
      !hasKickoff("Engineer")
    ) {
      throw new HttpError(
        409,
        "onboarding_delegation_incomplete",
        "Chief must publish the opener and every specialist kickoff before completing onboarding.",
      );
    }
    return chiefMessages;
  }

  /**
   * Appends sanitized log records to the workspace's retained log. Inserts
   * are idempotent by log id, so a retried POST never duplicates a record.
   */
  private async recordLogs(request: Request) {
    const context = readTrustedIdentity(request);
    const batch = logBatchSchema.parse(await parseJson(request));
    const workspace = this.requireWorkspace(context.workspaceId);
    this.requireMember(context.identity);
    if (
      batch.logs.some((entry) => entry.workspaceId !== workspace.workspace_id)
    ) {
      return relayError(
        409,
        "workspace_mismatch",
        "Every log must belong to the routed workspace.",
      );
    }
    appendWorkspaceLogs(this.ctx.storage, batch);
    return json({ accepted: batch.logs.length });
  }

  /** Reads the workspace's retained log, newest first, bounded and cursorable. */
  private listLogs(request: Request) {
    const context = readTrustedIdentity(request);
    const workspace = this.requireWorkspace(context.workspaceId);
    this.requireMember(context.identity);
    return json(
      readWorkspaceLogs(
        this.ctx.storage,
        workspaceIdSchema.parse(workspace.workspace_id),
        new URL(request.url),
      ),
    );
  }

  private requireWorkspace(expectedWorkspaceId: string) {
    const workspace = firstRow<WorkspaceRow>(
      this.ctx.storage.sql.exec("SELECT * FROM workspace WHERE singleton = 1"),
    );
    if (!workspace) {
      throw new HttpError(
        404,
        "workspace_not_found",
        "This workspace has not been claimed yet.",
      );
    }
    if (workspace.workspace_id !== expectedWorkspaceId) {
      throw new HttpError(
        409,
        "workspace_mismatch",
        "The request was routed to a different workspace.",
      );
    }
    return workspace;
  }

  private requireMember(identity: AuthenticatedIdentity) {
    const member = firstRow<MemberRow>(
      this.ctx.storage.sql.exec(
        `SELECT principal_kind, principal_id, role FROM members
         WHERE principal_kind = ? AND principal_id = ?`,
        identity.kind,
        identityId(identity),
      ),
    );
    if (!member) {
      throw new HttpError(
        403,
        "workspace_access_denied",
        "This identity is not a workspace member.",
      );
    }
    return member;
  }

  private memberRole(kind: string, principalId: string) {
    const member = firstRow<MemberRow>(
      this.ctx.storage.sql.exec(
        `SELECT principal_kind, principal_id, role FROM members
         WHERE principal_kind = ? AND principal_id = ?`,
        kind,
        principalId,
      ),
    );
    return member?.role ?? null;
  }

  /**
   * Dispatches a channels operation. Every channel operation requires at least
   * workspace membership; the read/write splits and owner rules are enforced
   * inside each named handler. The acting principal comes from the trusted
   * context so registered agents can create channels and add members during
   * kick-off without impersonating a user.
   */
  private async channel(request: Request, operation: string) {
    const context = readTrustedContext(request);
    this.requirePrincipalMember(context.principal);
    this.requireAgentCapability(context.principal, "channels");
    switch (operation) {
      case "channels-create":
        return await this.channelsCreate(request, context);
      case "channels-list":
        return this.channelsList(context);
      case "channels-get":
        return this.channelsGet(request, context);
      case "channels-update":
        return await this.channelsUpdate(request, context);
      case "channels-archive":
        return await this.channelsArchive(
          request,
          channelArchiveCommandSchema,
          true,
          context,
        );
      case "channels-unarchive":
        return await this.channelsArchive(
          request,
          channelUnarchiveCommandSchema,
          false,
          context,
        );
      case "channels-join":
        return await this.channelsJoin(request, context);
      case "channels-leave":
        return await this.channelsLeave(request, context);
      case "channels-members-list":
        return this.channelsMembersList(request, context);
      case "channels-memberships-list":
        return this.channelsMembershipsList(context);
      case "channels-members-add":
        return await this.channelsMembersAdd(request, context);
      case "channels-members-remove":
        return await this.channelsMembersRemove(request, context);
      default:
        return relayError(404, "not_found", "Channel operation not found.");
    }
  }

  private async channelsCreate(
    request: Request,
    context: ReturnType<typeof readTrustedContext>,
  ) {
    const command = channelCreateCommandSchema.parse(await parseJson(request));
    const { kind, id } = principalKindId(context.principal);
    if (kind === "service") {
      throw new HttpError(
        403,
        "principal_required",
        "Only a user or agent can create a channel.",
      );
    }
    const now = new Date().toISOString();
    this.ctx.storage.transactionSync(() => {
      const existing = firstRow<ChannelRow>(
        this.ctx.storage.sql.exec(
          "SELECT conversation_id FROM channels WHERE conversation_id = ?",
          command.payload.conversationId,
        ),
      );
      if (existing) {
        throw new HttpError(
          409,
          "channel_already_exists",
          "A channel with that id already exists.",
        );
      }
      this.ctx.storage.sql.exec(
        `INSERT INTO channels (
          conversation_id, workspace_id, name, kind, is_private, archived, description,
          created_by_kind, created_by_id, version, created_at, updated_at
        ) VALUES (?, ?, ?, 'channel', ?, 0, NULL, ?, ?, 1, ?, ?)`,
        command.payload.conversationId,
        context.workspaceId,
        command.payload.name,
        command.payload.isPrivate ? 1 : 0,
        kind,
        id,
        now,
        now,
      );
      this.ctx.storage.sql.exec(
        `INSERT INTO channel_members (
          conversation_id, principal_kind, principal_id, role, joined_at
        ) VALUES (?, ?, ?, 'owner', ?)`,
        command.payload.conversationId,
        kind,
        id,
        now,
      );
      this.rewriteSnapshot((conversations) => {
        conversations.push({
          id: command.payload.conversationId,
          name: command.payload.name,
          kind: "channel",
          isPrivate: command.payload.isPrivate,
          archived: false,
          unreadCount: 0,
          requiresAttention: false,
          lastMessage: null,
        });
      });
    });
    recordMetrics(this.env, ["channel-created"]);
    return json(this.channelDetail(command.payload.conversationId), {
      status: 201,
    });
  }

  private channelsList(context: ReturnType<typeof readTrustedContext>) {
    const { kind, id } = principalKindId(context.principal);
    const rows = this.ctx.storage.sql
      .exec(
        `SELECT c.conversation_id, c.workspace_id, c.name, c.is_private,
                c.archived, c.created_at
         FROM channels c
         WHERE c.kind = 'channel' AND (c.is_private = 0 OR EXISTS (
           SELECT 1 FROM channel_members cm
           WHERE cm.conversation_id = c.conversation_id
             AND cm.principal_kind = ? AND cm.principal_id = ?
         ))
         ORDER BY archived ASC, created_at ASC, conversation_id ASC`,
        kind,
        id,
      )
      .toArray() as ChannelRow[];
    return json(
      channelListResultSchema.parse({
        channels: rows.map(channelRecordFromRow),
      }),
    );
  }

  /** Starts or reuses a two-party direct conversation. Membership is derived
   * exclusively from the authenticated principal and a current workspace
   * member, so clients cannot smuggle arbitrary participants into a DM. */
  private async directsStart(request: Request) {
    const context = readTrustedContext(request);
    this.requirePrincipalMember(context.principal);
    this.requireAgentCapability(context.principal, "messages");
    const { kind, id } = principalKindId(context.principal);
    if (kind === "service") {
      throw new HttpError(
        403,
        "principal_required",
        "A user or agent is required.",
      );
    }
    const command = directStartCommandSchema.parse(await parseJson(request));
    const target = command.payload.participant;
    if (target.kind === kind && target.principalId === id) {
      throw new HttpError(
        400,
        "direct_self_denied",
        "Choose another workspace member.",
      );
    }
    this.requireWorkspaceMember(target.kind, target.principalId);

    const existing = firstRow<ChannelRow>(
      this.ctx.storage.sql.exec(
        `SELECT c.* FROM channels c
         WHERE c.kind = 'direct'
           AND EXISTS (SELECT 1 FROM channel_members a
             WHERE a.conversation_id = c.conversation_id
               AND a.principal_kind = ? AND a.principal_id = ?)
           AND EXISTS (SELECT 1 FROM channel_members b
             WHERE b.conversation_id = c.conversation_id
               AND b.principal_kind = ? AND b.principal_id = ?)
         ORDER BY c.created_at ASC LIMIT 1`,
        kind,
        id,
        target.kind,
        target.principalId,
      ),
    );
    if (existing) {
      return json(
        directStartResultSchema.parse({
          conversation: this.directSummary(
            existing,
            target.kind,
            target.principalId,
          ),
        }),
      );
    }

    const pair = [`${kind}:${id}`, `${target.kind}:${target.principalId}`]
      .sort()
      .join("|");
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(pair),
    );
    const conversationId = `dm-${Array.from(new Uint8Array(digest))
      .slice(0, 16)
      .map((value) => value.toString(16).padStart(2, "0"))
      .join("")}`;
    const name = this.principalDisplayName(target.kind, target.principalId);
    const now = new Date().toISOString();
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        `INSERT INTO channels (
          conversation_id, workspace_id, name, kind, is_private, archived,
          description, created_by_kind, created_by_id, version, created_at,
          updated_at
        ) VALUES (?, ?, ?, 'direct', 1, 0, NULL, ?, ?, 1, ?, ?)`,
        conversationId,
        context.workspaceId,
        name,
        kind,
        id,
        now,
        now,
      );
      this.ctx.storage.sql.exec(
        `INSERT INTO channel_members (
          conversation_id, principal_kind, principal_id, role, joined_at
        ) VALUES (?, ?, ?, 'owner', ?), (?, ?, ?, 'member', ?)`,
        conversationId,
        kind,
        id,
        now,
        conversationId,
        target.kind,
        target.principalId,
        now,
      );
      this.rewriteSnapshot((conversations) => {
        conversations.push({
          id: conversationId,
          name,
          kind: "direct",
          isPrivate: true,
          archived: false,
          unreadCount: 0,
          requiresAttention: false,
          lastMessage: null,
        });
      });
    });
    return json(
      directStartResultSchema.parse({
        conversation: this.directSummary(
          this.requireChannel(conversationId),
          target.kind,
          target.principalId,
        ),
      }),
      { status: 201 },
    );
  }

  private directSummary(
    row: ChannelRow,
    targetKind: "user" | "agent",
    targetId: string,
  ) {
    return {
      id: String(row.conversation_id),
      name: this.principalDisplayName(targetKind, targetId),
      kind: "direct" as const,
      isPrivate: true,
      archived: Number(row.archived) === 1,
      unreadCount: 0,
      requiresAttention: false,
      lastMessage: null,
    };
  }

  private principalDisplayName(kind: "user" | "agent", principalId: string) {
    return this.principalNames().get(`${kind}:${principalId}`) ?? principalId;
  }

  private channelsGet(
    request: Request,
    context: ReturnType<typeof readTrustedContext>,
  ) {
    const conversationId = parseChannelId(
      new URL(request.url).searchParams.get("conversationId"),
    );
    this.requireChannelVisible(conversationId, context.principal);
    return json(this.channelDetail(conversationId));
  }

  private async channelsUpdate(
    request: Request,
    context: ReturnType<typeof readTrustedContext>,
  ) {
    const command = channelUpdateCommandSchema.parse(await parseJson(request));
    const conversationId = command.payload.conversationId;
    const existing = this.requireChannel(conversationId);
    this.requireChannelManager(conversationId, context.principal);
    const name = command.payload.name ?? String(existing.name);
    const isPrivate =
      command.payload.isPrivate ?? Number(existing.is_private) === 1;
    const now = new Date().toISOString();
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        `UPDATE channels SET name = ?, is_private = ?, version = version + 1,
         updated_at = ? WHERE conversation_id = ?`,
        name,
        isPrivate ? 1 : 0,
        now,
        conversationId,
      );
      this.rewriteSnapshot((conversations) => {
        const entry = conversations.find(
          (conversation) => conversation.id === conversationId,
        );
        if (entry) {
          entry.name = name;
          entry.isPrivate = isPrivate;
        }
      });
    });
    return json(this.channelRecord(conversationId));
  }

  private async channelsArchive(
    request: Request,
    schema: typeof channelArchiveCommandSchema,
    archived: boolean,
    context: ReturnType<typeof readTrustedContext>,
  ) {
    const command = schema.parse(await parseJson(request));
    const conversationId = command.payload.conversationId;
    this.requireChannel(conversationId);
    this.requireChannelManager(conversationId, context.principal);
    const now = new Date().toISOString();
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        `UPDATE channels SET archived = ?, version = version + 1,
         updated_at = ? WHERE conversation_id = ?`,
        archived ? 1 : 0,
        now,
        conversationId,
      );
      this.rewriteSnapshot((conversations) => {
        const entry = conversations.find(
          (conversation) => conversation.id === conversationId,
        );
        if (entry) entry.archived = archived;
      });
    });
    return json(this.channelRecord(conversationId));
  }

  private async channelsJoin(
    request: Request,
    context: ReturnType<typeof readTrustedContext>,
  ) {
    const command = channelJoinCommandSchema.parse(await parseJson(request));
    const conversationId = command.payload.conversationId;
    const channel = this.requireChannel(conversationId);
    const { kind, id } = principalKindId(context.principal);
    if (kind === "service") {
      throw new HttpError(
        403,
        "principal_required",
        "Only a user or agent can join a channel.",
      );
    }
    if (
      Number(channel.is_private) === 1 &&
      !this.channelMembership(conversationId, kind, id)
    ) {
      throw new HttpError(
        403,
        "private_channel_invite_required",
        "Private channels require an invitation from a channel manager.",
      );
    }
    const now = new Date().toISOString();
    this.ctx.storage.sql.exec(
      `INSERT INTO channel_members (
        conversation_id, principal_kind, principal_id, role, joined_at
      ) VALUES (?, ?, ?, 'member', ?)
      ON CONFLICT(conversation_id, principal_kind, principal_id) DO NOTHING`,
      conversationId,
      kind,
      id,
      now,
    );
    return json(channelActionResultSchema.parse({ ok: true }));
  }

  private async channelsLeave(
    request: Request,
    context: ReturnType<typeof readTrustedContext>,
  ) {
    const command = channelLeaveCommandSchema.parse(await parseJson(request));
    const conversationId = command.payload.conversationId;
    this.requireChannel(conversationId);
    const { kind, id } = principalKindId(context.principal);
    const membership = firstRow<ChannelMemberRow>(
      this.ctx.storage.sql.exec(
        `SELECT * FROM channel_members
         WHERE conversation_id = ? AND principal_kind = ? AND principal_id = ?`,
        conversationId,
        kind,
        id,
      ),
    );
    if (membership?.role === "owner") {
      throw new HttpError(
        403,
        "channel_owner_leave_denied",
        "The channel owner cannot leave a channel they own.",
      );
    }
    this.ctx.storage.sql.exec(
      `DELETE FROM channel_members
       WHERE conversation_id = ? AND principal_kind = ? AND principal_id = ?`,
      conversationId,
      kind,
      id,
    );
    return json(channelActionResultSchema.parse({ ok: true }));
  }

  private channelsMembersList(
    request: Request,
    context: ReturnType<typeof readTrustedContext>,
  ) {
    const conversationId = parseChannelId(
      new URL(request.url).searchParams.get("conversationId"),
    );
    this.requireChannelVisible(conversationId, context.principal);
    return json(
      channelMembersResultSchema.parse({
        members: this.channelMemberRows(conversationId),
      }),
    );
  }

  /** All channel memberships in the workspace, for cheap roster membership UIs. */
  private channelsMembershipsList(
    context: ReturnType<typeof readTrustedContext>,
  ) {
    const member = this.requirePrincipalMember(context.principal);
    if (member.role !== "owner" && member.role !== "admin") {
      throw new HttpError(
        403,
        "channel_memberships_denied",
        "Only a workspace owner or admin can list all channel memberships.",
      );
    }
    const rows = this.ctx.storage.sql
      .exec(
        `SELECT conversation_id, principal_kind, principal_id, role, joined_at
         FROM channel_members
         ORDER BY conversation_id, principal_kind, principal_id`,
      )
      .toArray() as ChannelMemberRow[];
    return json({
      memberships: rows.map((row) => ({
        conversationId: String(row.conversation_id),
        kind: String(row.principal_kind) as "user" | "agent",
        principalId: String(row.principal_id),
        role: String(row.role) as "owner" | "admin" | "member",
        joinedAt: String(row.joined_at),
      })),
    });
  }

  private async channelsMembersAdd(
    request: Request,
    context: ReturnType<typeof readTrustedContext>,
  ) {
    const command = channelMemberAddCommandSchema.parse(
      await parseJson(request),
    );
    const conversationId = command.payload.conversationId;
    this.requireChannel(conversationId);
    this.requireChannelManager(conversationId, context.principal);
    const receipt = firstRow<ChannelMembershipBatchRow>(
      this.ctx.storage.sql.exec(
        "SELECT * FROM channel_membership_batches WHERE command_id = ?",
        command.commandId,
      ),
    );
    if (receipt) {
      if (receipt.conversation_id !== conversationId) {
        throw new HttpError(
          409,
          "command_reuse_denied",
          "This command id already belongs to another channel operation.",
        );
      }
      await this.publishPendingMembershipBatch(context.workspaceId, receipt);
      return json(channelActionResultSchema.parse({ ok: true }));
    }

    const requested = uniqueMemberTargets(
      "members" in command.payload
        ? command.payload.members
        : [
            {
              kind: command.payload.kind,
              principalId: command.payload.principalId,
            },
          ],
    );
    for (const target of requested) {
      this.requireWorkspaceMember(target.kind, target.principalId);
    }
    const additions = requested.filter(
      (target) =>
        !this.channelMembership(
          conversationId,
          target.kind,
          target.principalId,
        ),
    );
    const now = new Date().toISOString();
    const pendingEvent: PendingChannelMembershipBatchEvent = {
      commandId: command.commandId,
      messageId: crypto.randomUUID(),
      actor: context.principal,
      targets: additions.map((target) => ({
        kind: target.kind,
        id: target.principalId,
        name:
          target.kind === "user"
            ? "you"
            : (defaultWorkspaceAgents.find(
                (agent) => agent.id === target.principalId,
              )?.name ?? humanizeIdentifier(target.principalId)),
      })),
      occurredAt: now,
    };
    this.ctx.storage.transactionSync(() => {
      for (const target of additions) {
        this.ctx.storage.sql.exec(
          `INSERT INTO channel_members (
            conversation_id, principal_kind, principal_id, role, joined_at
          ) VALUES (?, ?, ?, 'member', ?)
          ON CONFLICT(conversation_id, principal_kind, principal_id) DO NOTHING`,
          conversationId,
          target.kind,
          target.principalId,
          now,
        );
      }
      this.ctx.storage.sql.exec(
        `INSERT INTO channel_membership_batches (
          command_id, conversation_id, event_json, published
        ) VALUES (?, ?, ?, ?)`,
        command.commandId,
        conversationId,
        JSON.stringify(pendingEvent),
        additions.length > 0 ? 0 : 1,
      );
      this.rewriteSnapshot(() => undefined);
    });
    const pending = firstRow<ChannelMembershipBatchRow>(
      this.ctx.storage.sql.exec(
        "SELECT * FROM channel_membership_batches WHERE command_id = ?",
        command.commandId,
      ),
    );
    if (pending)
      await this.publishPendingMembershipBatch(context.workspaceId, pending);
    return json(channelActionResultSchema.parse({ ok: true }));
  }

  private async publishPendingMembershipBatch(
    workspaceId: string,
    row: ChannelMembershipBatchRow,
  ) {
    if (row.published === 1) return;
    const event = parsePendingChannelMembershipBatchEvent(row.event_json);
    await this.publishMemberAddedEvent(workspaceId, row.conversation_id, event);
    this.ctx.storage.sql.exec(
      `UPDATE channel_membership_batches SET published = 1
       WHERE command_id = ?`,
      row.command_id,
    );
  }

  private async publishMemberAddedEvent(
    workspaceId: string,
    conversationId: string,
    event: PendingChannelMembershipBatchEvent,
  ) {
    const parsedWorkspaceId = workspaceIdSchema.parse(workspaceId);
    const { commandId, messageId, actor, targets, occurredAt } = event;
    const actorId =
      actor.kind === "agent"
        ? actor.agentId
        : actor.kind === "user"
          ? actor.userId
          : actor.service;
    const actorName =
      actor.kind === "agent"
        ? (defaultWorkspaceAgents.find((agent) => agent.id === actor.agentId)
            ?.name ?? humanizeIdentifier(actor.agentId))
        : actor.kind === "user"
          ? "You"
          : "Chief";
    const targetNames = targets.map((target) => target.name);
    const body = `${actorName} added ${formatNameList(targetNames)} to the channel.`;
    const append = appendMessageCommandSchema.parse({
      commandId,
      protocolVersion: 1,
      occurredAt,
      payload: {
        messageId,
        conversationId,
        body,
        mentions: [],
        components: [
          {
            id: `membership-${commandId}`,
            kind: "channel-action",
            version: 1,
            payload: {
              type: "member-added",
              actorId,
              actorName,
              actorType: actor.kind,
              targetId: targets[0]?.id ?? "",
              targetKind: targets[0]?.kind ?? "agent",
              targetName: targets[0]?.name ?? "a member",
              targetIds: targets.map((target) => target.id).join(","),
              targetNames: targetNames.join(","),
            },
          },
        ],
      },
    });
    const relayPrincipal = {
      kind: "service" as const,
      service: "chief-relay",
      workspaceId: parsedWorkspaceId,
    };
    const workspace = this.requireWorkspace(parsedWorkspaceId);
    const conversation = this.env.CONVERSATIONS.get(
      this.env.CONVERSATIONS.idFromName(
        `${workspace.workspace_id}:${conversationId}`,
      ),
    );
    const response = await conversation.fetch(
      withTrustedContext(
        new Request("https://conversation.internal/messages", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(append),
        }),
        {
          principal: relayPrincipal,
          requestId: commandId,
          workspaceId: parsedWorkspaceId,
          conversationId,
        },
      ),
    );
    if (!response.ok) {
      throw new HttpError(
        502,
        "membership_event_failed",
        "The channel membership event could not be published.",
      );
    }
  }

  private async channelsMembersRemove(
    request: Request,
    context: ReturnType<typeof readTrustedContext>,
  ) {
    const command = channelMemberRemoveCommandSchema.parse(
      await parseJson(request),
    );
    const conversationId = command.payload.conversationId;
    this.requireChannel(conversationId);
    const { kind, id } = principalKindId(context.principal);
    const actorMembership = firstRow<ChannelMemberRow>(
      this.ctx.storage.sql.exec(
        `SELECT * FROM channel_members
         WHERE conversation_id = ? AND principal_kind = ? AND principal_id = ?`,
        conversationId,
        kind,
        id,
      ),
    );
    const targetMembership = firstRow<ChannelMemberRow>(
      this.ctx.storage.sql.exec(
        `SELECT * FROM channel_members
         WHERE conversation_id = ? AND principal_kind = ? AND principal_id = ?`,
        conversationId,
        command.payload.kind,
        command.payload.principalId,
      ),
    );
    const isSelf =
      command.payload.kind === kind && command.payload.principalId === id;
    const isChannelOwner = actorMembership?.role === "owner";
    const isWorkspaceOwner = this.memberRole(kind, id) === "owner";
    if (targetMembership?.role === "owner" && !isWorkspaceOwner) {
      throw new HttpError(
        403,
        "channel_owner_remove_denied",
        "The channel owner can only be removed by a workspace owner.",
      );
    }
    if (!isSelf && !isChannelOwner && !isWorkspaceOwner) {
      throw new HttpError(
        403,
        "channel_member_remove_denied",
        "Only the member themselves, the channel owner, or a workspace owner can remove a member.",
      );
    }
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        `DELETE FROM channel_members
         WHERE conversation_id = ? AND principal_kind = ? AND principal_id = ?`,
        conversationId,
        command.payload.kind,
        command.payload.principalId,
      );
      this.ctx.storage.sql.exec(
        `DELETE FROM channel_membership_events
         WHERE conversation_id = ? AND principal_kind = ? AND principal_id = ?`,
        conversationId,
        command.payload.kind,
        command.payload.principalId,
      );
      this.rewriteSnapshot(() => undefined);
    });
    return json(channelActionResultSchema.parse({ ok: true }));
  }

  private requirePrincipalMember(principal: Principal) {
    const { kind, id } = principalKindId(principal);
    const member = firstRow<MemberRow>(
      this.ctx.storage.sql.exec(
        `SELECT principal_kind, principal_id, role FROM members
         WHERE principal_kind = ? AND principal_id = ?`,
        kind,
        id,
      ),
    );
    if (!member) {
      throw new HttpError(
        403,
        "workspace_access_denied",
        "This identity is not a workspace member.",
      );
    }
    return member;
  }

  private agentConfiguration(agentId: string) {
    const row = firstRow<AgentConfigRow>(
      this.ctx.storage.sql.exec(
        "SELECT agent_id, config_json, updated_at FROM agent_configs WHERE agent_id = ?",
        agentId,
      ),
    );
    return row
      ? agentConfigSchema.parse(JSON.parse(row.config_json))
      : defaultAgentConfigFor(agentId);
  }

  private requireAgentCapability(principal: Principal, capability: string) {
    if (principal.kind !== "agent") return;
    const config = this.agentConfiguration(principal.agentId);
    if (!config.enabled || !config.toolPermissions.includes(capability)) {
      throw new HttpError(
        403,
        "agent_capability_denied",
        `Workspace policy does not grant this agent the ${capability} capability.`,
      );
    }
  }

  private requireWorkspaceMember(kind: "user" | "agent", principalId: string) {
    const member = firstRow<MemberRow>(
      this.ctx.storage.sql.exec(
        `SELECT principal_kind, principal_id, role FROM members
         WHERE principal_kind = ? AND principal_id = ?`,
        kind,
        principalId,
      ),
    );
    if (!member) {
      throw new HttpError(
        403,
        "workspace_access_denied",
        "The target principal is not a workspace member.",
      );
    }
    return member;
  }

  private requireChannelVisible(conversationId: string, principal: Principal) {
    const channel = this.requireChannel(conversationId);
    if (Number(channel.is_private) === 0) return channel;
    const { kind, id } = principalKindId(principal);
    if (
      kind !== "service" &&
      this.channelMembership(conversationId, kind, id)
    ) {
      return channel;
    }
    throw new HttpError(
      403,
      "channel_access_denied",
      "This identity is not a member of the private channel.",
    );
  }

  private requireChannelManager(conversationId: string, principal: Principal) {
    const { kind, id } = principalKindId(principal);
    if (kind === "service") {
      throw new HttpError(
        403,
        "channel_manage_denied",
        "A user or agent is required.",
      );
    }
    const workspaceRole = this.memberRole(kind, id);
    const channelRole = this.channelMembership(conversationId, kind, id)?.role;
    if (
      workspaceRole === "owner" ||
      workspaceRole === "admin" ||
      channelRole === "owner" ||
      channelRole === "admin"
    ) {
      return;
    }
    throw new HttpError(
      403,
      "channel_manage_denied",
      "Only a channel manager or workspace administrator can change this channel.",
    );
  }

  private channelMembership(
    conversationId: string,
    kind: "user" | "agent",
    principalId: string,
  ) {
    return firstRow<ChannelMemberRow>(
      this.ctx.storage.sql.exec(
        `SELECT * FROM channel_members
         WHERE conversation_id = ? AND principal_kind = ? AND principal_id = ?`,
        conversationId,
        kind,
        principalId,
      ),
    );
  }

  private requireChannel(conversationId: string) {
    const row = firstRow<ChannelRow>(
      this.ctx.storage.sql.exec(
        "SELECT * FROM channels WHERE conversation_id = ?",
        conversationId,
      ),
    );
    if (!row) {
      throw new HttpError(
        404,
        "channel_not_found",
        "The channel does not exist.",
      );
    }
    return row;
  }

  private channelRecord(conversationId: string) {
    return channelRecordSchema.parse(
      channelRecordFromRow(this.requireChannel(conversationId)),
    );
  }

  private channelDetail(conversationId: string) {
    return channelDetailSchema.parse({
      channel: this.channelRecord(conversationId),
      members: this.channelMemberRows(conversationId),
    });
  }

  private channelMemberRows(conversationId: string) {
    const rows = this.ctx.storage.sql
      .exec(
        `SELECT * FROM channel_members
         WHERE conversation_id = ? ORDER BY joined_at ASC, principal_id ASC`,
        conversationId,
      )
      .toArray() as ChannelMemberRow[];
    const names = this.principalNames();
    return rows.map((row) => ({
      kind: row.principal_kind,
      principalId: String(row.principal_id),
      role: row.role,
      joinedAt: String(row.joined_at),
      ...(names.get(`${row.principal_kind}:${row.principal_id}`)
        ? { name: names.get(`${row.principal_kind}:${row.principal_id}`) }
        : {}),
    }));
  }

  /** Best-effort display names for channel members: agents are named in the
   * managed snapshot; users carry no profile on the relay yet. */
  private principalNames() {
    const names = new Map<string, string>();
    const workspace = firstRow<WorkspaceRow>(
      this.ctx.storage.sql.exec(
        "SELECT snapshot_json FROM workspace WHERE singleton = 1",
      ),
    );
    if (!workspace?.snapshot_json) return names;
    const snapshot = workspaceSnapshotSchema.parse(
      JSON.parse(workspace.snapshot_json),
    );
    for (const agent of snapshot.agents) {
      names.set(`agent:${agent.id}`, agent.name);
    }
    return names;
  }

  /** Re-parses, mutates, and persists the managed workspace snapshot. The
   * conversations array carries the channel name/isPrivate/archived state so
   * clients never need to round-trip a channels RPC for the home screen. */
  private rewriteSnapshot(
    mutate: (conversations: WorkspaceSnapshot["conversations"]) => void,
  ) {
    const workspace = firstRow<WorkspaceRow>(
      this.ctx.storage.sql.exec(
        "SELECT snapshot_json FROM workspace WHERE singleton = 1",
      ),
    );
    if (!workspace?.snapshot_json) return;
    const snapshot = workspaceSnapshotSchema.parse(
      JSON.parse(workspace.snapshot_json),
    );
    mutate(snapshot.conversations);
    this.ctx.storage.sql.exec(
      "UPDATE workspace SET snapshot_json = ? WHERE singleton = 1",
      JSON.stringify(snapshot),
    );
  }

  /** Backfills channel authority for managed snapshots created before the
   * channel tables existed. This is idempotent and never overwrites roles. */
  private ensureSnapshotChannels() {
    const workspace = firstRow<WorkspaceRow>(
      this.ctx.storage.sql.exec("SELECT * FROM workspace WHERE singleton = 1"),
    );
    if (!workspace?.snapshot_json) return;
    const snapshot = workspaceSnapshotSchema.parse(
      JSON.parse(workspace.snapshot_json),
    );
    this.seedSnapshotChannels(
      snapshot,
      workspace.created_by_user_id,
      workspace.created_at,
    );
  }

  private seedSnapshotChannels(
    snapshot: WorkspaceSnapshot,
    ownerId: string,
    createdAt: string,
  ) {
    for (const conversation of snapshot.conversations) {
      this.ctx.storage.sql.exec(
        `INSERT INTO channels (
          conversation_id, workspace_id, name, kind, is_private, archived,
          description, created_by_kind, created_by_id, version, created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, NULL, 'user', ?, 1, ?, ?)
        ON CONFLICT(conversation_id) DO UPDATE SET kind = excluded.kind`,
        conversation.id,
        snapshot.id,
        conversation.name,
        conversation.kind,
        conversation.isPrivate ? 1 : 0,
        conversation.archived ? 1 : 0,
        ownerId,
        createdAt,
        createdAt,
      );
      this.ctx.storage.sql.exec(
        `INSERT INTO channel_members (
          conversation_id, principal_kind, principal_id, role, joined_at
        ) VALUES (?, 'user', ?, 'owner', ?)
        ON CONFLICT(conversation_id, principal_kind, principal_id) DO NOTHING`,
        conversation.id,
        ownerId,
        createdAt,
      );
    }
  }
}

function parsePendingChannelMembershipBatchEvent(
  value: string,
): PendingChannelMembershipBatchEvent {
  const candidate = JSON.parse(value) as Record<string, unknown>;
  if (!Array.isArray(candidate.targets)) {
    throw new HttpError(
      500,
      "membership_event_invalid",
      "The pending channel membership event is invalid.",
    );
  }
  const targets = candidate.targets.map((value) => {
    if (!value || typeof value !== "object")
      throw new HttpError(
        500,
        "membership_event_invalid",
        "The pending channel membership event is invalid.",
      );
    const target = value as Record<string, unknown>;
    if (target.kind !== "user" && target.kind !== "agent")
      throw new HttpError(
        500,
        "membership_event_invalid",
        "The pending channel membership event is invalid.",
      );
    return {
      kind: target.kind as "user" | "agent",
      id: String(target.id),
      name: String(target.name),
    };
  });
  return {
    commandId: commandIdSchema.parse(candidate.commandId),
    messageId: messageIdSchema.parse(candidate.messageId),
    actor: principalSchema.parse(candidate.actor),
    targets,
    occurredAt: isoDateTimeSchema.parse(candidate.occurredAt),
  };
}

function uniqueMemberTargets(
  targets: ReadonlyArray<{
    kind: "user" | "agent";
    principalId: string;
  }>,
) {
  const seen = new Set<string>();
  return targets.filter((target) => {
    const key = `${target.kind}:${target.principalId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function formatNameList(names: readonly string[]) {
  if (names.length <= 1) return names[0] ?? "a member";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names.at(-1)}`;
}

function workspaceDataCapability(operation: string) {
  if (operation === "data-brand-save") return "brand-profile-write";
  if (operation === "data-prospect-save") return "prospects-write";
  return "workspace";
}

function defaultAgentConfigFor(agentId: string) {
  if (agentId === "brand") {
    return agentConfigSchema.parse({
      ...defaultAgentConfig,
      capabilities: ["brand-memory", "advanced"],
      toolPermissions: [
        ...defaultAgentConfig.toolPermissions,
        "brand-profile-write",
      ],
    });
  }
  if (agentId === "prospector") {
    return agentConfigSchema.parse({
      ...defaultAgentConfig,
      capabilities: ["prospect-memory", "advanced"],
      toolPermissions: [
        ...defaultAgentConfig.toolPermissions,
        "prospects-write",
      ],
    });
  }
  return defaultAgentConfig;
}

function identityId(identity: AuthenticatedIdentity) {
  if (identity.kind === "user") return identity.userId;
  if (identity.kind === "agent") return identity.agentId;
  return identity.service;
}

function humanizeIdentifier(value: string) {
  return value
    .split(/[-_]/u)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function principalKindId(principal: Principal) {
  if (principal.kind === "user") {
    return { kind: "user" as const, id: principal.userId };
  }
  if (principal.kind === "agent") {
    return { kind: "agent" as const, id: principal.agentId };
  }
  return { kind: "service" as const, id: principal.service };
}

function channelRecordFromRow(row: ChannelRow) {
  return {
    id: conversationIdSchema.parse(String(row.conversation_id)),
    workspaceId: workspaceIdSchema.parse(String(row.workspace_id)),
    name: String(row.name),
    isPrivate: Number(row.is_private) === 1,
    archived: Number(row.archived) === 1,
    createdAt: String(row.created_at),
  };
}

function parseChannelId(value: string | null) {
  if (value === null) {
    throw new HttpError(
      400,
      "missing_conversation",
      "A conversationId query parameter is required.",
    );
  }
  return conversationIdSchema.parse(decodeURIComponent(value));
}

function toPrincipal(
  identity: AuthenticatedIdentity,
  member: MemberRow,
  workspace: WorkspaceRow,
): Principal {
  if (identity.kind === "user") {
    return {
      kind: "user",
      userId: identity.userId,
      pubkey: identity.pubkey,
      workspaceId: workspaceIdSchema.parse(workspace.workspace_id),
      role: member.role,
    };
  }
  if (identity.kind === "agent") {
    return {
      kind: "agent",
      agentId: identity.agentId,
      pubkey: identity.pubkey,
      workspaceId: workspaceIdSchema.parse(workspace.workspace_id),
    };
  }
  return {
    kind: "service",
    service: identity.service,
    workspaceId: workspaceIdSchema.parse(workspace.workspace_id),
  };
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

function firstRow<T>(cursor: Iterable<T>): T | undefined {
  return cursor[Symbol.iterator]().next().value as T | undefined;
}
