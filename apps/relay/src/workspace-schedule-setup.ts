import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

import type {
  Principal,
  WorkspaceSchedule,
  WorkspaceScheduleInput,
} from "@chief/relay-contracts";
import { conversationIdSchema, missionSchema } from "@chief/relay-contracts";

import type { WorkspaceChannelStore } from "./workspace-channel-store";
import { HttpError } from "./http";
import { requireAgentMessageAccess } from "./workspace-agent-messaging";
import { principalKindId } from "./workspace-channel-store";
import { readWorkspaceMission } from "./workspace-missions";

/** Called in the save transaction so failed validation leaves no partial setup. */
export function prepareScheduleChannel(
  store: WorkspaceChannelStore,
  workspaceId: string,
  principal: Principal,
  input: WorkspaceScheduleInput,
): asserts input is WorkspaceScheduleInput &
  Pick<WorkspaceSchedule, "conversationId"> {
  const team = [...new Set([input.agentId, ...input.collaborators])];
  for (const agentId of team) {
    store.requireWorkspaceMember("agent", agentId);
    requireAgentMessageAccess(store, agentId, principal);
  }
  const now = new Date().toISOString();
  if (input.newChannel) {
    const suffix = bytesToHex(sha256(new TextEncoder().encode(input.id))).slice(
      0,
      32,
    );
    const conversationId = conversationIdSchema.parse(`mission-${suffix}`);
    if (input.missionId && input.missionId !== conversationId)
      throw new HttpError(
        400,
        "schedule_mission_conflict",
        "Choose an existing mission or create a new channel, not both.",
      );
    const exists =
      store.storage.sql
        .exec(
          "SELECT conversation_id FROM channels WHERE conversation_id = ?",
          conversationId,
        )
        .toArray().length > 0;
    if (!exists) {
      store.requireAgentCapability(principal, "channels.create");
      const { kind, id } = principalKindId(principal);
      if (kind === "service")
        throw new HttpError(
          403,
          "principal_required",
          "A user or agent is required.",
        );
      const name =
        input.newChannel.name ??
        (input.title
          .toLowerCase()
          .replace(/[^\p{L}\p{N}]+/gu, "-")
          .replace(/^-+|-+$/gu, "")
          .slice(0, 64) ||
          "mission");
      store.storage.sql.exec(
        `INSERT INTO channels (conversation_id, workspace_id, name, kind, is_private, archived, description,
          created_by_kind, created_by_id, version, created_at, updated_at)
         VALUES (?, ?, ?, 'channel', 0, 0, ?, ?, ?, 1, ?, ?)`,
        conversationId,
        workspaceId,
        name,
        input.instructions.slice(0, 1000),
        kind,
        id,
        now,
        now,
      );
      store.storage.sql.exec(
        "INSERT INTO channel_members (conversation_id, principal_kind, principal_id, role, joined_at) VALUES (?, ?, ?, 'owner', ?)",
        conversationId,
        kind,
        id,
        now,
      );
      store.rewriteSnapshot((conversations) => {
        conversations.push({
          id: conversationId,
          name,
          kind: "channel",
          isPrivate: false,
          archived: false,
          unreadCount: 0,
          requiresAttention: false,
          lastMessage: null,
        });
      });
    }
    input.conversationId = conversationId;
    input.missionId = conversationId;
  }
  if (!input.conversationId)
    throw new HttpError(
      400,
      "schedule_channel_required",
      "Choose a channel or supply newChannel.",
    );
  store.requireChannelVisible(input.conversationId, principal);
  const conversationId = input.conversationId;
  const targets = [
    ...team.map((id) => ({ kind: "agent" as const, id })),
    ...(input.newChannel?.inviteUserIds ?? []).map((id) => ({
      kind: "user" as const,
      id,
    })),
  ];
  const missing = targets.filter(
    ({ kind, id }) => !store.channelMembership(conversationId, kind, id),
  );
  if (missing.length) {
    store.requireAgentCapability(principal, "members.manage");
    store.requireChannelManager(input.conversationId, principal);
    for (const { kind, id } of missing) {
      store.requireWorkspaceMember(kind, id);
      store.storage.sql.exec(
        "INSERT OR IGNORE INTO channel_members (conversation_id, principal_kind, principal_id, role, joined_at) VALUES (?, ?, ?, ?, ?)",
        input.conversationId,
        kind,
        id,
        input.newChannel && kind === "agent" && id === input.agentId
          ? "admin"
          : "member",
        now,
      );
    }
  }
  if (
    input.newChannel &&
    input.missionId &&
    !readWorkspaceMission(store.storage, input.missionId)
  ) {
    const mission = missionSchema.parse({
      id: input.missionId,
      conversationId: input.conversationId,
      workspaceId,
      title: input.title,
      objective: input.instructions.slice(0, 4000),
      ownerAgentId: input.agentId,
      collaborators: input.collaborators,
      success: {
        kind: "deliverable",
        description: input.expectedOutcome || input.instructions.slice(0, 2000),
      },
      constraints:
        input.constraints ||
        "Work within granted permissions. Ask before spending money or publishing externally.",
      maxExperiments: 100,
      deadline: new Date(Date.now() + 365 * 86_400_000).toISOString(),
      status: "active",
      experiments: [],
      statusEvidence: null,
      createdAt: now,
      updatedAt: now,
    });
    store.storage.sql.exec(
      "INSERT INTO missions (mission_id, document_json) VALUES (?, ?)",
      mission.id,
      JSON.stringify(mission),
    );
  }
}
