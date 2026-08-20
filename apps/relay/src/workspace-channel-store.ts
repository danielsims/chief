import type { Principal, WorkspaceSnapshot } from "@chief/relay-contracts";
import {
  agentConfigSchema,
  channelDetailSchema,
  channelRecordSchema,
  conversationIdSchema,
  defaultAgentConfig,
  workspaceIdSchema,
  workspaceSnapshotSchema,
} from "@chief/relay-contracts";

import { HttpError } from "./http";

export interface MemberRow extends Record<string, SqlStorageValue> {
  principal_kind: "user" | "agent" | "service";
  principal_id: string;
  role: "owner" | "admin" | "member";
}

export interface AgentConfigRow extends Record<string, SqlStorageValue> {
  agent_id: string;
  config_json: string;
  updated_at: string;
}

export interface ChannelRow extends Record<string, SqlStorageValue> {
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

export interface ChannelMemberRow extends Record<string, SqlStorageValue> {
  conversation_id: string;
  principal_kind: "user" | "agent";
  principal_id: string;
  role: "owner" | "admin" | "member";
  joined_at: string;
}

export interface WorkspaceRow extends Record<string, SqlStorageValue> {
  workspace_id: string;
  name: string;
  created_at: string;
  created_by_user_id: string;
  snapshot_json: string | null;
}

export class WorkspaceChannelStore {
  constructor(
    readonly storage: DurableObjectStorage,
    readonly env: Env,
  ) {}

  memberRole(kind: string, principalId: string) {
    const member = firstRow<MemberRow>(
      this.storage.sql.exec(
        `SELECT principal_kind, principal_id, role FROM members
         WHERE principal_kind = ? AND principal_id = ?`,
        kind,
        principalId,
      ),
    );
    return member?.role ?? null;
  }

  requireWorkspace(expectedWorkspaceId: string) {
    const workspace = firstRow<WorkspaceRow>(
      this.storage.sql.exec("SELECT * FROM workspace WHERE singleton = 1"),
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

  requirePrincipalMember(principal: Principal) {
    const { kind, id } = principalKindId(principal);
    const member = firstRow<MemberRow>(
      this.storage.sql.exec(
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

  agentConfiguration(agentId: string) {
    const row = firstRow<AgentConfigRow>(
      this.storage.sql.exec(
        "SELECT agent_id, config_json, updated_at FROM agent_configs WHERE agent_id = ?",
        agentId,
      ),
    );
    return row
      ? agentConfigSchema.parse(JSON.parse(row.config_json))
      : defaultAgentConfigFor(agentId);
  }

  requireAgentCapability(principal: Principal, capability: string) {
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

  requireWorkspaceMember(kind: "user" | "agent", principalId: string) {
    const member = firstRow<MemberRow>(
      this.storage.sql.exec(
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

  requireChannelVisible(conversationId: string, principal: Principal) {
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

  requireChannelManager(conversationId: string, principal: Principal) {
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

  channelMembership(
    conversationId: string,
    kind: "user" | "agent",
    principalId: string,
  ) {
    return firstRow<ChannelMemberRow>(
      this.storage.sql.exec(
        `SELECT * FROM channel_members
         WHERE conversation_id = ? AND principal_kind = ? AND principal_id = ?`,
        conversationId,
        kind,
        principalId,
      ),
    );
  }

  requireChannel(conversationId: string) {
    const row = firstRow<ChannelRow>(
      this.storage.sql.exec(
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

  channelRecord(conversationId: string) {
    return channelRecordSchema.parse(
      channelRecordFromRow(this.requireChannel(conversationId)),
    );
  }

  channelDetail(conversationId: string) {
    return channelDetailSchema.parse({
      channel: this.channelRecord(conversationId),
      members: this.channelMemberRows(conversationId),
    });
  }

  channelMemberRows(conversationId: string) {
    const rows = this.storage.sql
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
  principalNames() {
    const names = new Map<string, string>();
    const workspace = firstRow<WorkspaceRow>(
      this.storage.sql.exec(
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
  rewriteSnapshot(
    mutate: (conversations: WorkspaceSnapshot["conversations"]) => void,
  ) {
    const workspace = firstRow<WorkspaceRow>(
      this.storage.sql.exec(
        "SELECT snapshot_json FROM workspace WHERE singleton = 1",
      ),
    );
    if (!workspace?.snapshot_json) return;
    const snapshot = workspaceSnapshotSchema.parse(
      JSON.parse(workspace.snapshot_json),
    );
    mutate(snapshot.conversations);
    this.storage.sql.exec(
      "UPDATE workspace SET snapshot_json = ? WHERE singleton = 1",
      JSON.stringify(snapshot),
    );
  }

  /** Backfills channel authority for managed snapshots created before the
   * channel tables existed. This is idempotent and never overwrites roles. */
  ensureSnapshotChannels() {
    const workspace = firstRow<WorkspaceRow>(
      this.storage.sql.exec("SELECT * FROM workspace WHERE singleton = 1"),
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

  seedSnapshotChannels(
    snapshot: WorkspaceSnapshot,
    ownerId: string,
    createdAt: string,
  ) {
    for (const conversation of snapshot.conversations) {
      this.storage.sql.exec(
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
      this.storage.sql.exec(
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

export function principalKindId(principal: Principal) {
  if (principal.kind === "user")
    return { kind: "user" as const, id: principal.userId };
  if (principal.kind === "agent")
    return { kind: "agent" as const, id: principal.agentId };
  return { kind: "service" as const, id: principal.service };
}

export function channelRecordFromRow(row: ChannelRow) {
  return {
    id: conversationIdSchema.parse(String(row.conversation_id)),
    workspaceId: workspaceIdSchema.parse(String(row.workspace_id)),
    name: String(row.name),
    isPrivate: Number(row.is_private) === 1,
    archived: Number(row.archived) === 1,
    createdAt: String(row.created_at),
  };
}

export function parseChannelId(value: string | null) {
  if (value === null) {
    throw new HttpError(
      400,
      "missing_conversation",
      "A conversationId query parameter is required.",
    );
  }
  return conversationIdSchema.parse(decodeURIComponent(value));
}

export function firstRow<T>(cursor: Iterable<T>): T | undefined {
  return cursor[Symbol.iterator]().next().value as T | undefined;
}
