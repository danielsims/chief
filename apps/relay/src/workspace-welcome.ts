import { WELCOME_CHANNEL_NAME, welcomeChannelId } from "@chief/relay-contracts";

import { channelMembersAddAgentToExistingChannel } from "./queries/channel-members/add-agent-to-existing-channel";
import { channelMembersInsertSeedSnapshotChannels } from "./queries/channel-members/insert-seed-snapshot-channels";
import { channelsFindCreateChannel } from "./queries/channels/find-create-channel";
import { channelsInsertSeedSnapshotChannels } from "./queries/channels/insert-seed-snapshot-channels";
import { firstRow } from "./workspace-channel-rows";

/**
 * A person's private channel with Chief, where Chief welcomes them and brings
 * in teammates only when the work needs them. Created once; afterwards the
 * channel owns its own membership.
 */
export function ensureWelcomeChannel(
  storage: DurableObjectStorage,
  {
    workspaceId,
    userId,
    now,
  }: { workspaceId: string; userId: string; now: string },
) {
  const conversationId = welcomeChannelId(userId);
  if (firstRow(channelsFindCreateChannel(storage, conversationId)))
    return conversationId;
  channelsInsertSeedSnapshotChannels(storage, {
    conversationId,
    workspaceId,
    name: WELCOME_CHANNEL_NAME,
    kind: "channel",
    isPrivate: 1,
    archived: 0,
    createdById: userId,
    createdAt: now,
    updatedAt: now,
  });
  channelMembersInsertSeedSnapshotChannels(storage, {
    conversationId,
    principalId: userId,
    joinedAt: now,
  });
  channelMembersAddAgentToExistingChannel(storage, {
    conversationId,
    agentId: "chief",
    joinedAt: now,
  });
  return conversationId;
}
