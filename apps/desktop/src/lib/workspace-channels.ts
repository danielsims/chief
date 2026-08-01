export const WORKSPACE_CHANNELS = [
  {
    id: "analytics",
    relayId: "84d669ac-a8b3-4c09-8dd1-a620c2a76141",
    label: "analytics",
    description: "Measurement, reporting, and performance",
    agentIds: ["cmo", "analyst"],
  },
  {
    id: "advertising",
    relayId: "680f1a12-1e39-4727-9784-988857e11c6d",
    label: "advertising",
    description: "Campaigns, creative, and acquisition",
    agentIds: ["cmo", "ads", "content"],
  },
  {
    id: "prospecting",
    relayId: "f6758067-06e1-4c55-aec8-54377bedc965",
    label: "prospecting",
    description: "Research, leads, and outreach",
    agentIds: ["cmo", "prospector"],
  },
  {
    id: "general",
    relayId: "a842c23b-03fe-42e7-a0bf-1f9687004195",
    label: "general",
    description: "Planning and work across the company",
    agentIds: ["cmo", "brand", "content"],
  },
] as const;

export type WorkspaceChannelId = (typeof WORKSPACE_CHANNELS)[number]["id"];

const CHANNEL_KEYWORDS: {
  id: Exclude<WorkspaceChannelId, "general">;
  keywords: string[];
}[] = [
  {
    id: "analytics",
    keywords: ["analytics", "report", "performance", "traffic", "measurement"],
  },
  {
    id: "advertising",
    keywords: ["advertising", "campaign", "creative", "acquisition", "launch"],
  },
  {
    id: "prospecting",
    keywords: ["prospect", "lead", "outreach", "buyer", "market research"],
  },
];

/** Classify durable work outputs; conversations are never inferred this way. */
export function channelForText(value: string): WorkspaceChannelId {
  const searchable = value.toLocaleLowerCase();
  return (
    CHANNEL_KEYWORDS.find((channel) =>
      channel.keywords.some((keyword) => searchable.includes(keyword)),
    )?.id ?? "general"
  );
}

export function workspaceChannel(channelId: string | null) {
  return WORKSPACE_CHANNELS.find((channel) => channel.id === channelId) ?? null;
}

export function channelChatId(channelId: WorkspaceChannelId) {
  const channel = workspaceChannel(channelId);
  if (!channel) throw new Error("Channel was not found.");
  return `channel:${channel.relayId}`;
}

/** Place a channel at a pinned drop target, without duplicates. */
export function placePinnedChannel(
  pinnedIds: readonly WorkspaceChannelId[],
  channelId: WorkspaceChannelId,
  overChannelId: WorkspaceChannelId | null,
) {
  const oldIndex = pinnedIds.indexOf(channelId);
  if (overChannelId === channelId) return [...pinnedIds];

  const next = pinnedIds.filter((id) => id !== channelId);
  if (!overChannelId) return [...next, channelId];

  const overIndex = pinnedIds.indexOf(overChannelId);
  if (overIndex < 0) return [...next, channelId];
  const insertAt = oldIndex >= 0 ? overIndex : Math.min(overIndex, next.length);
  next.splice(insertAt, 0, channelId);
  return next;
}
