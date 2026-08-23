import type { WorkspaceChannel } from "@chief/agent-runtime/types";
import type { RelayClient } from "@chief/relay-client";
import type { WorkspaceSnapshot } from "@chief/relay-contracts";
import { RelayClientError } from "@chief/relay-client";

import { workspaceChannelFromRelay } from "./relay-channel-adapter";

export async function loadRelayWorkspaceChannels(
  relay: RelayClient,
  snapshot: WorkspaceSnapshot,
) {
  const [records, currentMemberships, allMemberships] = await Promise.all([
    relay.listChannels(),
    relay.listCurrentChannelMemberships(),
    relay.listChannelMemberships().catch((error: unknown) => {
      if (error instanceof RelayClientError && error.status === 403)
        return null;
      throw error;
    }),
  ]);
  const memberLists = allMemberships
    ? records.map((channel) =>
        allMemberships
          .filter((membership) => membership.conversationId === channel.id)
          .map((membership) => ({
            ...membership,
            ...(membership.kind === "agent"
              ? {
                  name: snapshot.agents.find(
                    (agent) => agent.id === membership.principalId,
                  )?.name,
                }
              : {}),
          })),
      )
    : await Promise.all(
        records.map((channel) => relay.listChannelMembers(channel.id)),
      );
  const currentByChannel = new Map(
    currentMemberships.map((membership) => [
      membership.conversationId,
      membership,
    ]),
  );
  const channels: WorkspaceChannel[] = records.map((channel, index) =>
    workspaceChannelFromRelay(
      channel,
      memberLists[index] ?? [],
      currentByChannel.get(channel.id),
    ),
  );
  return { channels, currentMemberships };
}

export async function createRelayWorkspaceChannel(
  relay: RelayClient,
  rawName: string,
) {
  const name = rawName.trim();
  if (!name) throw new Error("Channel name is required.");
  const detail = await relay.createChannel({
    conversationId: crypto.randomUUID(),
    name,
    isPrivate: false,
  });
  const currentMemberships = await relay.listCurrentChannelMemberships();
  return workspaceChannelFromRelay(
    detail.channel,
    detail.members,
    currentMemberships.find(
      (membership) => membership.conversationId === detail.channel.id,
    ),
  );
}
