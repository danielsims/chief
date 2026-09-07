import { z } from "zod";

import type { Principal, WorkspaceSnapshot } from "@chief/relay-contracts";
import {
  agentConfigSchema,
  channelDetailSchema,
  channelRecordSchema,
} from "@chief/relay-contracts";

import { HttpError } from "./http";
import { agentConfigsFindConfigGet } from "./queries/agent-configs/find-config-get";
import { agentKeysFindAgentPubkey } from "./queries/agent-keys/find-agent-pubkey";
import { channelMembersAddAgentToExistingChannel } from "./queries/channel-members/add-agent-to-existing-channel";
import { channelMembersEnsureMissionChief } from "./queries/channel-members/ensure-mission-chief";
import { channelMembersFindChannelMemberRows } from "./queries/channel-members/find-channel-member-rows";
import { channelMembersFindChannelsMembersRemove } from "./queries/channel-members/find-channels-members-remove";
import { channelMembersInsertSeedSnapshotChannels } from "./queries/channel-members/insert-seed-snapshot-channels";
import { channelsFindChannelsCreate } from "./queries/channels/find-channels-create";
import { channelsInsertSeedSnapshotChannels } from "./queries/channels/insert-seed-snapshot-channels";
import { externalAgentRuntimesFindAgentIsLive } from "./queries/external-agent-runtimes/find-agent-is-live";
import { membersFindAuthorize } from "./queries/members/find-authorize";
import { membersFindWorkspaceAgentIds } from "./queries/members/find-workspace-agent-ids";
import { membersInsertRegisterAgentKey } from "./queries/members/insert-register-agent-key";
import { workspaceFindAuthorize } from "./queries/workspace/find-authorize";
import { workspaceFindWorkspaceAgent } from "./queries/workspace/find-workspace-agent";
import { workspaceUpdateVerifyConnection } from "./queries/workspace/update-verify-connection";
import {
  defaultAgentConfigFor,
  effectiveAgentConfigFor,
  hasAgentPermission,
} from "./workspace-agent-config";
import {
  channelRecordFromRow,
  firstRow,
  principalKindId,
} from "./workspace-channel-rows";
import {
  decodeWorkspaceSnapshot,
  workspaceAgentProfiles,
} from "./workspace-defaults";
import { memberDisplayNames } from "./workspace-member-names";

export {
  channelRecordFromRow,
  firstRow,
  parseChannelId,
  principalKindId,
} from "./workspace-channel-rows";

const channelMemberRowSchema = z.object({
  conversation_id: z.string(),
  principal_kind: z.union([z.literal("user"), z.literal("agent")]),
  principal_id: z.string(),
  role: z.union([z.literal("owner"), z.literal("admin"), z.literal("member")]),
  joined_at: z.string(),
});

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
      membersFindAuthorize(this.storage, kind, principalId),
    );
    return member?.role ?? null;
  }

  workspaceAgentIds() {
    return membersFindWorkspaceAgentIds<MemberRow>(this.storage).map(
      (row) => row.principal_id,
    );
  }

  requireWorkspace(expectedWorkspaceId: string) {
    const workspace = firstRow<WorkspaceRow>(
      workspaceFindAuthorize(this.storage),
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
      membersFindAuthorize(this.storage, kind, id),
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
      agentConfigsFindConfigGet(this.storage, agentId),
    );
    return row
      ? effectiveAgentConfigFor(
          agentId,
          agentConfigSchema.parse(JSON.parse(row.config_json)),
        )
      : defaultAgentConfigFor(agentId);
  }

  agentPubkey(agentId: string) {
    return firstRow<{ pubkey: string }>(
      agentKeysFindAgentPubkey(this.storage, agentId),
    )?.pubkey;
  }

  requireAgentCapability(principal: Principal, capability: string) {
    if (principal.kind !== "agent") return;
    const config = this.agentConfiguration(principal.agentId);
    if (
      !this.agentIsLive(principal.agentId) ||
      !hasAgentPermission(config.toolPermissions, capability)
    ) {
      throw new HttpError(
        403,
        "agent_capability_denied",
        `Workspace policy does not grant this agent the ${capability} capability.`,
      );
    }
  }

  agentIsLive(agentId: string) {
    const runtime = firstRow<{ connection_status: string }>(
      externalAgentRuntimesFindAgentIsLive(this.storage, agentId),
    );
    return (
      this.agentConfiguration(agentId).enabled ||
      runtime?.connection_status === "connected"
    );
  }

  requireWorkspaceMember(
    kind: "user" | "agent" | "service",
    principalId: string,
  ) {
    const member = firstRow<MemberRow>(
      membersFindAuthorize(this.storage, kind, principalId),
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

  canReadConversation(conversationId: string, principal: Principal) {
    try {
      this.requirePrincipalMember(principal);
      this.requireAgentCapability(principal, "messages.read");
      this.requireChannelVisible(conversationId, principal);
      return true;
    } catch {
      return false;
    }
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
      channelMembersFindChannelsMembersRemove(this.storage, {
        conversationId: conversationId,
        principalKind: kind,
        principalId: principalId,
      }),
    );
  }

  requireChannel(conversationId: string) {
    const row = firstRow<ChannelRow>(
      channelsFindChannelsCreate(this.storage, conversationId),
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
    const rows = channelMembersFindChannelMemberRows(
      this.storage,
      conversationId,
    ).map((row) => channelMemberRowSchema.parse(row));
    const names = this.principalNames();
    return rows.map((row) => ({
      kind: row.principal_kind,
      principalId: String(row.principal_id),
      role: row.role,
      joinedAt: String(row.joined_at),
      ...(names.get(`${row.principal_kind}:${row.principal_id}`)
        ? { name: names.get(`${row.principal_kind}:${row.principal_id}`) }
        : undefined),
    }));
  }

  /** Display names for channel members. Agents come from the managed
   * snapshot; users are cached from the auth profile onto the members row. */
  principalNames() {
    const names = memberDisplayNames(this.storage);
    const workspace = firstRow<WorkspaceRow>(
      workspaceFindWorkspaceAgent(this.storage),
    );
    if (!workspace?.snapshot_json) return names;
    const snapshot = decodeWorkspaceSnapshot(workspace.snapshot_json);
    for (const agent of workspaceAgentProfiles(snapshot)) {
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
      workspaceFindWorkspaceAgent(this.storage),
    );
    if (!workspace?.snapshot_json) return;
    const snapshot = decodeWorkspaceSnapshot(workspace.snapshot_json);
    mutate(snapshot.conversations);
    workspaceUpdateVerifyConnection(this.storage, JSON.stringify(snapshot));
  }

  /** Backfills channel authority for managed snapshots created before the
   * channel tables existed. This is idempotent and never overwrites roles. */
  ensureSnapshotChannels() {
    const workspace = firstRow<WorkspaceRow>(
      workspaceFindAuthorize(this.storage),
    );
    if (!workspace?.snapshot_json) return;
    const snapshot = decodeWorkspaceSnapshot(workspace.snapshot_json);
    this.seedSnapshotChannels(
      snapshot,
      workspace.created_by_user_id,
      workspace.created_at,
    );
    this.seedSnapshotAgents(snapshot, workspace.created_at);
  }

  /** Managed agents exist independently of a device key. A phone/desktop may
   * later register a signing key for the same principal, while a cloud cell can
   * execute immediately under the relay's trusted Durable Object boundary. */
  seedSnapshotAgents(snapshot: WorkspaceSnapshot, createdAt: string) {
    for (const agent of workspaceAgentProfiles(snapshot)) {
      membersInsertRegisterAgentKey(this.storage, agent.id, createdAt);
      channelMembersAddAgentToExistingChannel(this.storage, {
        agentId: agent.id,
        joinedAt: createdAt,
        conversationId: agent.id,
      });
    }
    if (snapshot.agents.some((agent) => agent.id === "chief")) {
      channelMembersEnsureMissionChief(this.storage, createdAt);
    }
  }

  seedSnapshotChannels(
    snapshot: WorkspaceSnapshot,
    ownerId: string,
    createdAt: string,
  ) {
    for (const conversation of snapshot.conversations) {
      channelsInsertSeedSnapshotChannels(this.storage, {
        conversationId: conversation.id,
        workspaceId: snapshot.id,
        name: conversation.name,
        kind: conversation.kind,
        isPrivate: conversation.isPrivate ? 1 : 0,
        archived: conversation.archived ? 1 : 0,
        createdById: ownerId,
        createdAt: createdAt,
        updatedAt: createdAt,
      });
      channelMembersInsertSeedSnapshotChannels(this.storage, {
        conversationId: conversation.id,
        principalId: ownerId,
        joinedAt: createdAt,
      });
    }
  }
}
