export const GETTING_STARTED_CHANNEL_ID = "getting-started";
export const GETTING_STARTED_CHANNEL_RELAY_ID =
  "04e8b4b0-3b65-4a83-a2e0-7fd5aa9f70c4";

export const WORKSPACE_CHANNELS = [
  {
    id: GETTING_STARTED_CHANNEL_ID,
    relayId: GETTING_STARTED_CHANNEL_RELAY_ID,
    label: "getting-started",
    description: "Private setup with Chief and Setup",
    agentIds: ["cmo", "setup"],
  },
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

export const WORKSPACE_AGENT_IDENTITIES = {
  cmo: { name: "Chief", role: "Chief Marketing Officer" },
  setup: { name: "Setup", role: "Private Workspace Setup" },
  analyst: { name: "Analyst", role: "Measurement and Reporting" },
  ads: { name: "Advertising", role: "Paid Acquisition" },
  content: { name: "Content", role: "Content and Creative" },
  prospector: { name: "Prospector", role: "Research and Outreach" },
  brand: { name: "Brand", role: "Brand Research" },
} as const;

export type WorkspaceAgentId = keyof typeof WORKSPACE_AGENT_IDENTITIES;

export type SidebarPinnedItem =
  | { kind: "channel"; id: WorkspaceChannelId }
  | { kind: "agent"; id: WorkspaceAgentId };

export function sidebarPinnedItemKey(item: SidebarPinnedItem) {
  return `${item.kind}:${item.id}`;
}

export function isSidebarPinnedItem(
  value: unknown,
): value is SidebarPinnedItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<SidebarPinnedItem>;
  if (typeof item.id !== "string") return false;
  return (
    item.kind === "channel" ||
    (item.kind === "agent" &&
      Object.hasOwn(WORKSPACE_AGENT_IDENTITIES, item.id))
  );
}

export const WORKSPACE_DIRECT_MESSAGES = [
  { id: "cmo", relayId: "cc7d57ef-d6ea-4ebf-a987-2dc33d18c8c7" },
  { id: "setup", relayId: "147c5d7b-8e35-43f1-94dd-230484502e81" },
  { id: "analyst", relayId: "a644f850-6825-4a21-84cf-c1d4780875cc" },
  { id: "ads", relayId: "af454f32-d70c-4ef0-ab73-5b78d73710ba" },
  { id: "content", relayId: "3a9618e0-ef52-46af-988e-e19cd7111dfa" },
  { id: "prospector", relayId: "0094ccf0-fd7e-4c8a-b0a9-648758ae31d5" },
  { id: "brand", relayId: "16ca9ad9-7497-4cff-84f0-ff03550a88ac" },
] as const satisfies readonly { id: WorkspaceAgentId; relayId: string }[];

export type WorkspaceChannelId = string;

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

export function channelChatId(
  channelId: WorkspaceChannelId,
  workspaceId?: string | null,
) {
  const channel = workspaceChannel(channelId);
  const relayId = channel?.relayId ?? channelId;
  return workspaceId
    ? `channel:${workspaceId}:${relayId}`
    : `channel:${relayId}`;
}

export function channelIdFromChatId(chatId: string | null) {
  if (!chatId?.startsWith("channel:")) return null;
  const scopedId = chatId.slice("channel:".length);
  return scopedId.slice(scopedId.lastIndexOf(":") + 1);
}

export function resolvedChannelChatId(
  channelId: WorkspaceChannelId,
  workspaceId: string | null | undefined,
  chats: readonly { id: string }[],
) {
  const scoped = channelChatId(channelId, workspaceId);
  if (chats.some((chat) => chat.id === scoped)) return scoped;
  const legacy = channelChatId(channelId);
  return chats.some((chat) => chat.id === legacy) ? legacy : scoped;
}

export function workspaceDirectMessage(agentId: string | null) {
  return (
    WORKSPACE_DIRECT_MESSAGES.find((message) => message.id === agentId) ?? null
  );
}

export function directMessageChatId(
  agentId: WorkspaceAgentId,
  workspaceId?: string | null,
) {
  const message = workspaceDirectMessage(agentId);
  if (!message) throw new Error("Direct message was not found.");
  return channelChatId(message.relayId, workspaceId);
}

export function directMessageIdsForChats(
  chats: readonly { id: string; lastText: string }[],
  workspaceId?: string | null,
) {
  return WORKSPACE_DIRECT_MESSAGES.filter((message) =>
    chats.some(
      (chat) =>
        (chat.id === directMessageChatId(message.id, workspaceId) ||
          chat.id === directMessageChatId(message.id)) &&
        chat.lastText.trim().length > 0,
    ),
  ).map((message) => message.id);
}

export function actionConversation(value: {
  title: string;
  reason?: string;
  agentId?: string;
}) {
  const text = `${value.title} ${value.reason ?? ""}`.toLocaleLowerCase();
  if (
    value.agentId === "setup" ||
    /connect|integration|credential|github|vercel|engineering tool/.test(text)
  ) {
    return { kind: "channel" as const, id: GETTING_STARTED_CHANNEL_ID };
  }
  return { kind: "channel" as const, id: channelForText(text) };
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

/** Place any sidebar destination at a pinned drop target, without duplicates. */
export function placeSidebarPinnedItem(
  pinnedItems: readonly SidebarPinnedItem[],
  item: SidebarPinnedItem,
  overItem: SidebarPinnedItem | null,
) {
  const itemKey = sidebarPinnedItemKey(item);
  const overKey = overItem ? sidebarPinnedItemKey(overItem) : null;
  const oldIndex = pinnedItems.findIndex(
    (candidate) => sidebarPinnedItemKey(candidate) === itemKey,
  );
  if (overKey === itemKey) return [...pinnedItems];

  const next = pinnedItems.filter(
    (candidate) => sidebarPinnedItemKey(candidate) !== itemKey,
  );
  if (!overKey) return [...next, item];

  const overIndex = pinnedItems.findIndex(
    (candidate) => sidebarPinnedItemKey(candidate) === overKey,
  );
  if (overIndex < 0) return [...next, item];
  const insertAt = oldIndex >= 0 ? overIndex : Math.min(overIndex, next.length);
  next.splice(insertAt, 0, item);
  return next;
}
