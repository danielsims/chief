import { createHash, randomUUID } from "node:crypto";

import type { ChannelActor, ChannelEvent, WorkspaceChannel } from "../types.js";

export const CHANNEL_CHAT_PREFIX = "channel:";

const DEFAULT_CHANNELS = [
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
] as const;

export function defaultWorkspaceChannels(now = Date.now()): WorkspaceChannel[] {
  return DEFAULT_CHANNELS.map((channel, index) => ({
    ...channel,
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

function actorPubkey(workspaceId: string, actor: ChannelActor) {
  return createHash("sha256")
    .update(`${workspaceId}\0${actor.type}\0${actor.id}`)
    .digest("hex");
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
  sourceId?: string;
  createdAt?: number;
}): ChannelEvent {
  const createdAt = input.createdAt ?? Date.now();
  const pubkey = actorPubkey(input.workspaceId, input.actor);
  const tags = [
    ["h", input.channelId],
    ...(input.mentions ?? []).map((mention) => ["p", mention]),
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
