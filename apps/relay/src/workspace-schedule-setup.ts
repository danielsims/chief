import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

import type {
  Principal,
  WorkspaceSchedule,
  WorkspaceScheduleInput,
} from "@chief/relay-contracts";
import { conversationIdSchema } from "@chief/relay-contracts";

import type { WorkspaceChannelStore } from "./workspace-channel-store";
import { HttpError } from "./http";
import { channelMembersInsertPrepareScheduleChannel } from "./queries/channel-members/insert-prepare-schedule-channel";
import { channelMembersInsertPrepareScheduleChannelRow } from "./queries/channel-members/insert-prepare-schedule-channel-row";
import { channelsFindCreateChannel } from "./queries/channels/find-create-channel";
import { channelsInsertPrepareScheduleChannel } from "./queries/channels/insert-prepare-schedule-channel";
import { requireAgentMessageAccess } from "./workspace-agent-messaging";
import { principalKindId } from "./workspace-channel-store";

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
    const conversationId = conversationIdSchema.parse(`automation-${suffix}`);
    const exists =
      channelsFindCreateChannel(store.storage, conversationId).length > 0;
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
          "automation");
      channelsInsertPrepareScheduleChannel(store.storage, {
        conversationId: conversationId,
        workspaceId: workspaceId,
        name: name,
        description: input.instructions.slice(0, 1000),
        createdByKind: kind,
        createdById: id,
        createdAt: now,
        updatedAt: now,
      });
      channelMembersInsertPrepareScheduleChannel(store.storage, {
        conversationId: conversationId,
        principalKind: kind,
        principalId: id,
        joinedAt: now,
      });
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
      channelMembersInsertPrepareScheduleChannelRow(store.storage, {
        conversationId: input.conversationId,
        principalKind: kind,
        principalId: id,
        role:
          input.newChannel && kind === "agent" && id === input.agentId
            ? "admin"
            : "member",
        joinedAt: now,
      });
    }
  }
}
