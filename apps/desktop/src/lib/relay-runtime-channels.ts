import type {
  ServerMessage,
  WorkspaceChannel,
} from "@chief/agent-runtime/types";
import type { RelayClient } from "@chief/relay-client";
import type { WorkspaceSnapshot } from "@chief/relay-contracts";
import { RelayClientError } from "@chief/relay-client";

import { workspaceChannelFromRelay } from "./relay-channel-adapter";

type RelayChannelClient = Pick<
  RelayClient,
  | "createChannel"
  | "listChannelMembers"
  | "listChannelMemberships"
  | "listChannels"
  | "listCurrentChannelMemberships"
>;

export async function loadRelayWorkspaceChannels(
  relay: RelayChannelClient,
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
              : undefined),
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
  const lastMessageAt = new Map(
    snapshot.conversations.flatMap((conversation) =>
      conversation.lastMessageAt
        ? [[conversation.id, Date.parse(conversation.lastMessageAt)] as const]
        : [],
    ),
  );
  const channels: WorkspaceChannel[] = records.map((channel, index) => {
    const at = lastMessageAt.get(channel.id);
    return {
      ...workspaceChannelFromRelay(
        channel,
        memberLists[index] ?? [],
        currentByChannel.get(channel.id),
      ),
      ...(at ? { lastMessageAt: at } : undefined),
    };
  });
  return { channels, currentMemberships };
}

export async function createRelayWorkspaceChannel(
  relay: RelayChannelClient,
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

/** Starts Welcome only once the main workspace's live event stream is attached. */
export class RelayChannelRoster {
  private welcomeStarted = false;
  private welcomeStart: Promise<void> | null = null;

  constructor(
    private readonly relay: RelayChannelClient &
      Partial<Pick<RelayClient, "startWorkspaceWelcome">>,
    private readonly subscribedIds: Set<string>,
    private readonly emit: (message: ServerMessage) => void,
    private readonly connect: () => Promise<void>,
    private readonly canStartWelcome: () => boolean,
  ) {}

  async list(snapshot: WorkspaceSnapshot) {
    const { channels, currentMemberships } = await loadRelayWorkspaceChannels(
      this.relay,
      snapshot,
    );
    this.emit({ type: "channels", workspaceId: snapshot.id, channels });
    for (const membership of currentMemberships)
      this.subscribedIds.add(membership.conversationId);
    for (const conversation of snapshot.conversations) {
      if (conversation.kind === "direct")
        this.subscribedIds.add(conversation.id);
    }
    await this.connect();
    if (
      this.canStartWelcome() &&
      snapshot.setupComplete === true &&
      !this.welcomeStarted &&
      this.relay.startWorkspaceWelcome
    ) {
      this.welcomeStart ??= this.relay
        .startWorkspaceWelcome()
        .then(() => {
          this.welcomeStarted = true;
        })
        .finally(() => {
          this.welcomeStart = null;
        });
      await this.welcomeStart;
    }
    return channels;
  }
}
