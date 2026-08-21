import type { AuthenticatedIdentity, Principal } from "@chief/relay-contracts";
import {
  agentConfigSchema,
  agentIdSchema,
  hexPubkeySchema,
  registerAgentKeyCommandSchema,
  updateWorkspaceMemberRoleCommandSchema,
  updateWorkspaceMemberRoleResultSchema,
  workspaceIdSchema,
  workspaceMemberListSchema,
} from "@chief/relay-contracts";

import type { readTrustedIdentity } from "./internal-context";
import type {
  AgentConfigRow,
  MemberRow,
  WorkspaceRow,
} from "./workspace-channel-store";
import { HttpError, json, parseJson, relayError } from "./http";
import { readTrustedContext } from "./internal-context";
import { recordMetrics } from "./metrics";
import {
  firstRow,
  parseChannelId,
  WorkspaceChannelStore,
} from "./workspace-channel-store";

interface AgentKeyRow extends Record<string, SqlStorageValue> {
  agent_id: string;
  pubkey: string;
  created_at: string;
}

export class WorkspaceAccessService {
  private readonly channels: WorkspaceChannelStore;

  constructor(
    private readonly storage: DurableObjectStorage,
    private readonly env: Env,
  ) {
    this.channels = new WorkspaceChannelStore(storage, env);
  }

  authorize(identity: AuthenticatedIdentity) {
    const agent =
      identity.kind === "user"
        ? firstRow<AgentKeyRow>(
            this.storage.sql.exec(
              "SELECT agent_id, pubkey, created_at FROM agent_keys WHERE pubkey = ?",
              identity.pubkey,
            ),
          )
        : undefined;
    const kind = agent ? "agent" : "user";
    const principalId = agent ? agent.agent_id : identityId(identity);
    const member = firstRow<MemberRow>(
      this.storage.sql.exec(
        `SELECT principal_kind, principal_id, role FROM members
         WHERE principal_kind = ? AND principal_id = ?`,
        kind,
        principalId,
      ),
    );
    const workspace = firstRow<WorkspaceRow>(
      this.storage.sql.exec("SELECT * FROM workspace WHERE singleton = 1"),
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

  async registerAgentKey(
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
    if (this.channels.memberRole("user", context.identity.userId) !== "owner") {
      return relayError(
        403,
        "owner_required",
        "Only a workspace owner can register agent keys.",
      );
    }
    const input = registerAgentKeyCommandSchema.parse(await parseJson(request));
    const existingAgent = firstRow<AgentKeyRow>(
      this.storage.sql.exec(
        "SELECT agent_id, pubkey, created_at FROM agent_keys WHERE agent_id = ?",
        input.agentId,
      ),
    );
    const existingKey = firstRow<AgentKeyRow>(
      this.storage.sql.exec(
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
    this.storage.transactionSync(() => {
      this.storage.sql.exec(
        `INSERT INTO agent_keys (agent_id, pubkey, created_at)
         VALUES (?, ?, ?)`,
        input.agentId,
        input.pubkey,
        createdAt,
      );
      this.storage.sql.exec(
        `INSERT INTO members (principal_kind, principal_id, role, created_at)
         VALUES ('agent', ?, 'member', ?)
         ON CONFLICT(principal_kind, principal_id) DO NOTHING`,
        input.agentId,
        createdAt,
      );
      this.storage.sql.exec(
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
        this.storage.sql.exec(
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

  agentKeys() {
    const rows = this.storage.sql
      .exec("SELECT agent_id, pubkey FROM agent_keys ORDER BY agent_id")
      .toArray() as AgentKeyRow[];
    return json({
      agents: rows.map((row) => ({
        agentId: agentIdSchema.parse(String(row.agent_id)),
        pubkey: hexPubkeySchema.parse(String(row.pubkey)),
      })),
    });
  }

  membersList(request: Request) {
    const context = readTrustedContext(request);
    this.channels.requirePrincipalMember(context.principal);
    this.channels.requireAgentCapability(context.principal, "members.read");
    const rows = this.storage.sql
      .exec(
        "SELECT principal_kind, principal_id, role FROM members ORDER BY principal_kind, principal_id",
      )
      .toArray() as MemberRow[];
    return json(
      workspaceMemberListSchema.parse({
        members: rows.map((row) => ({
          kind: row.principal_kind,
          principalId: row.principal_id,
          role: row.role,
        })),
      }),
    );
  }

  async memberRoleSet(request: Request) {
    const context = readTrustedContext(request);
    const actor = this.channels.requirePrincipalMember(context.principal);
    if (context.principal.kind !== "user" || actor.role !== "owner") {
      throw new HttpError(
        403,
        "workspace_role_manage_denied",
        "Only a workspace owner can change team member roles.",
      );
    }

    const url = new URL(request.url);
    const kind = url.searchParams.get("kind");
    const principalId = url.searchParams.get("principalId")?.trim();
    if (
      (kind !== "user" && kind !== "agent" && kind !== "service") ||
      !principalId
    ) {
      throw new HttpError(
        400,
        "invalid_workspace_member",
        "A valid team member kind and principal ID are required.",
      );
    }
    const input = updateWorkspaceMemberRoleCommandSchema.parse(
      await parseJson(request),
    );
    const target = this.channels.requireWorkspaceMember(kind, principalId);
    if (
      kind === "user" &&
      target.role === "owner" &&
      input.role !== "owner" &&
      this.humanOwnerCount() === 1
    ) {
      throw new HttpError(
        409,
        "last_workspace_owner",
        "A workspace must retain at least one owner.",
      );
    }

    this.storage.sql.exec(
      `UPDATE members SET role = ?
       WHERE principal_kind = ? AND principal_id = ?`,
      input.role,
      kind,
      principalId,
    );
    return json(
      updateWorkspaceMemberRoleResultSchema.parse({
        member: { kind, principalId, role: input.role },
      }),
    );
  }

  agentConfigGet(request: Request) {
    const context = readTrustedContext(request);
    this.requireAgentConfigAccess(context.principal, false);
    const rawAgentId = new URL(request.url).searchParams.get("agentId");
    if (!rawAgentId) {
      throw new HttpError(400, "missing_agent", "An agentId is required.");
    }
    const agentId = agentIdSchema.parse(rawAgentId);
    const row = firstRow<AgentConfigRow>(
      this.storage.sql.exec(
        "SELECT agent_id, config_json, updated_at FROM agent_configs WHERE agent_id = ?",
        agentId,
      ),
    );
    if (!row) {
      return json({
        agentId,
        config: this.channels.agentConfiguration(agentId),
        updatedAt: null,
      });
    }
    return json({
      agentId: agentIdSchema.parse(row.agent_id),
      config: agentConfigSchema.parse(JSON.parse(row.config_json)),
      updatedAt: row.updated_at,
    });
  }

  async agentConfigSet(request: Request) {
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
    this.storage.sql.exec(
      `INSERT INTO agent_configs (agent_id, config_json, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(agent_id) DO UPDATE SET config_json = excluded.config_json,
         updated_at = excluded.updated_at`,
      agentId,
      config,
      updatedAt,
    );
    return json({ agentId, config: JSON.parse(config) as unknown, updatedAt });
  }

  authorizeConversation(request: Request) {
    const context = readTrustedContext(request);
    this.channels.requirePrincipalMember(context.principal);
    const permission = request.headers.get("x-chief-required-permission");
    if (!isConversationPermission(permission)) {
      throw new HttpError(
        400,
        "missing_required_permission",
        "The internal conversation permission is required.",
      );
    }
    this.channels.requireAgentCapability(context.principal, permission);
    const conversationId = parseChannelId(
      new URL(request.url).searchParams.get("conversationId"),
    );
    this.channels.requireChannelVisible(conversationId, context.principal);
    return json({ ok: true });
  }

  authorizeAgentRuntime(request: Request) {
    const context = readTrustedContext(request);
    this.channels.requirePrincipalMember(context.principal);
    if (context.principal.kind !== "agent") {
      throw new HttpError(
        403,
        "agent_required",
        "An agent identity is required for agent runtime access.",
      );
    }
    if (!this.channels.agentConfiguration(context.principal.agentId).enabled) {
      throw new HttpError(
        403,
        "agent_disabled",
        "This agent is disabled by workspace policy.",
      );
    }
    return json({ ok: true });
  }

  private requireAgentConfigAccess(principal: Principal, write: boolean) {
    const member = this.channels.requirePrincipalMember(principal);
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

  private humanOwnerCount() {
    const row = firstRow<{ count: number }>(
      this.storage.sql.exec(
        `SELECT COUNT(*) AS count FROM members
         WHERE principal_kind = 'user' AND role = 'owner'`,
      ),
    );
    return Number(row?.count ?? 0);
  }
}

function isConversationPermission(
  value: string | null,
): value is "messages.read" | "messages.send" | "messages.manage" {
  return (
    value === "messages.read" ||
    value === "messages.send" ||
    value === "messages.manage"
  );
}

function identityId(identity: AuthenticatedIdentity) {
  if (identity.kind === "user") return identity.userId;
  if (identity.kind === "agent") return identity.agentId;
  return identity.service;
}

function toPrincipal(
  identity: AuthenticatedIdentity,
  member: MemberRow,
  workspace: WorkspaceRow,
): Principal {
  const workspaceId = workspaceIdSchema.parse(workspace.workspace_id);
  if (identity.kind === "user") {
    return {
      kind: "user",
      userId: identity.userId,
      pubkey: identity.pubkey,
      workspaceId,
      role: member.role,
    };
  }
  if (identity.kind === "agent") {
    return {
      kind: "agent",
      agentId: identity.agentId,
      pubkey: identity.pubkey,
      workspaceId,
      role: member.role,
    };
  }
  return { kind: "service", service: identity.service, workspaceId };
}
