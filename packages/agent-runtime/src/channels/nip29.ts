import { createHash, randomUUID } from "node:crypto";

import type {
  ChannelActor,
  ChannelMessageEvent,
  ChannelReactionEvent,
  WorkspaceChannel,
} from "../channel-types.js";

export const CHANNEL_CHAT_PREFIX = "channel:";
export const GETTING_STARTED_CHANNEL_ID =
  "04e8b4b0-3b65-4a83-a2e0-7fd5aa9f70c4";

const DEFAULT_CHANNELS = [
  {
    id: GETTING_STARTED_CHANNEL_ID,
    slug: "getting-started",
    name: "getting-started",
    description: "Private setup with Chief and Setup",
    agentIds: ["cmo", "setup"],
    visibility: "private",
  },
  {
    id: "84d669ac-a8b3-4c09-8dd1-a620c2a76141",
    slug: "analytics",
    name: "analytics",
    description: "Measurement, reporting, and performance",
    agentIds: ["cmo", "analyst"],
  },
  {
    id: "680f1a12-1e39-4727-9784-988857e11c6d",
    slug: "advertising",
    name: "advertising",
    description: "Campaigns, creative, and acquisition",
    agentIds: ["cmo", "ads", "content"],
  },
  {
    id: "f6758067-06e1-4c55-aec8-54377bedc965",
    slug: "prospecting",
    name: "prospecting",
    description: "Research, leads, and outreach",
    agentIds: ["cmo", "prospector"],
  },
  {
    id: "a842c23b-03fe-42e7-a0bf-1f9687004195",
    slug: "general",
    name: "general",
    description: "Planning and work across the company",
    agentIds: ["cmo", "brand", "content"],
  },
  {
    id: "cc7d57ef-d6ea-4ebf-a987-2dc33d18c8c7",
    slug: "dm-cmo",
    name: "Chief",
    description: "A direct conversation with Chief",
    agentIds: ["cmo"],
    visibility: "direct",
  },
  {
    id: "147c5d7b-8e35-43f1-94dd-230484502e81",
    slug: "dm-setup",
    name: "Setup",
    description: "A private workspace setup conversation",
    agentIds: ["setup"],
    visibility: "direct",
  },
  {
    id: "a644f850-6825-4a21-84cf-c1d4780875cc",
    slug: "dm-analyst",
    name: "Analyst",
    description: "A direct conversation with Analyst",
    agentIds: ["analyst"],
    visibility: "direct",
  },
  {
    id: "af454f32-d70c-4ef0-ab73-5b78d73710ba",
    slug: "dm-ads",
    name: "Advertising",
    description: "A direct conversation with Advertising",
    agentIds: ["ads"],
    visibility: "direct",
  },
  {
    id: "3a9618e0-ef52-46af-988e-e19cd7111dfa",
    slug: "dm-content",
    name: "Content",
    description: "A direct conversation with Content",
    agentIds: ["content"],
    visibility: "direct",
  },
  {
    id: "0094ccf0-fd7e-4c8a-b0a9-648758ae31d5",
    slug: "dm-prospector",
    name: "Prospector",
    description: "A direct conversation with Prospector",
    agentIds: ["prospector"],
    visibility: "direct",
  },
  {
    id: "16ca9ad9-7497-4cff-84f0-ff03550a88ac",
    slug: "dm-brand",
    name: "Brand",
    description: "A direct conversation with Brand",
    agentIds: ["brand"],
    visibility: "direct",
  },
] as const;

export function defaultWorkspaceChannels(now = Date.now()): WorkspaceChannel[] {
  return DEFAULT_CHANNELS.map((channel, index) => ({
    ...channel,
    topic: "",
    agentIds: [...channel.agentIds],
    protocol: "nip29",
    createdAt: now + index,
    updatedAt: now + index,
  }));
}

export function channelChatId(channelId: string) {
  return `${CHANNEL_CHAT_PREFIX}${channelId}`;
}

export function channelIdFromChatId(chatId: string) {
  return chatId.startsWith(CHANNEL_CHAT_PREFIX)
    ? chatId.slice(CHANNEL_CHAT_PREFIX.length)
    : null;
}

export function actorPubkey(workspaceId: string, actor: ChannelActor) {
  return createHash("sha256")
    .update(`${workspaceId}\0${actor.type}\0${actor.id}`)
    .digest("hex");
}

export function createChannelReaction(input: {
  workspaceId: string;
  channelId: string;
  targetEventId: string;
  actor: ChannelActor;
  reaction: string;
  createdAt?: number;
}): ChannelReactionEvent {
  const createdAt = input.createdAt ?? Date.now();
  const pubkey = actorPubkey(input.workspaceId, input.actor);
  const tags = [
    ["h", input.channelId],
    ["e", input.targetEventId, "", "reply"],
  ];
  const id = createHash("sha256")
    .update(
      JSON.stringify([
        0,
        pubkey,
        Math.floor(createdAt / 1000),
        7,
        tags,
        input.reaction,
        randomUUID(),
      ]),
    )
    .digest("hex");
  return {
    protocol: "nip29",
    id,
    channelId: input.channelId,
    kind: 7,
    pubkey,
    tags,
    content: input.reaction,
    actor: input.actor,
    createdAt,
  };
}

/**
 * Create Chief's local NIP-29 envelope. The local runtime is the authority, so
 * it does not forge a Nostr signature; a remote relay adapter signs the same
 * canonical fields at the transport boundary.
 */
export function createChannelEvent(input: {
  workspaceId: string;
  channelId: string;
  actor: ChannelActor;
  content: string;
  parts?: unknown[];
  mentions?: string[];
  channelAction?: {
    type: "member-added";
    agentIds: string[];
  };
  threadRootId?: string;
  sourceId?: string;
  createdAt?: number;
}): ChannelMessageEvent {
  const createdAt = input.createdAt ?? Date.now();
  const pubkey = actorPubkey(input.workspaceId, input.actor);
  const tags = [
    ["h", input.channelId],
    ...(input.mentions ?? []).map((mention) => [
      "p",
      actorPubkey(input.workspaceId, {
        type: "agent",
        id: mention,
        name: mention,
      }),
    ]),
    ...(input.channelAction
      ? [
          ["action", input.channelAction.type],
          ...input.channelAction.agentIds.map((agentId) => ["agent", agentId]),
        ]
      : []),
    ...(input.threadRootId
      ? [
          ["e", input.threadRootId, "", "root"],
          ["e", input.threadRootId, "", "reply"],
        ]
      : []),
    ...(input.sourceId ? [["client", input.sourceId]] : []),
  ];
  const nonce = input.sourceId ?? randomUUID();
  const id = createHash("sha256")
    .update(
      JSON.stringify([
        0,
        pubkey,
        Math.floor(createdAt / 1000),
        9,
        tags,
        input.content,
        nonce,
      ]),
    )
    .digest("hex");
  return {
    protocol: "nip29",
    id,
    channelId: input.channelId,
    kind: 9,
    pubkey,
    tags,
    content: input.content,
    parts: input.parts,
    actor: input.actor,
    createdAt,
  };
}
