import { isJsonString, parseJsonObject } from "@chief/relay-contracts";

export const WORKSPACE_CHANNELS = [
  {
    id: "engineering",
    relayId: "749ad53f-bcb0-4e78-8732-4b0e05b96942",
    label: "engineering",
    description: "Product changes, bugs, and technical reviews",
    agentIds: ["chief", "engineer"],
    userIds: [],
  },
  {
    id: "analytics",
    relayId: "84d669ac-a8b3-4c09-8dd1-a620c2a76141",
    label: "analytics",
    description: "Measurement, reporting, and performance",
    agentIds: ["chief", "analyst"],
    userIds: [],
  },
  {
    id: "advertising",
    relayId: "680f1a12-1e39-4727-9784-988857e11c6d",
    label: "advertising",
    description: "Campaigns, creative, and acquisition",
    agentIds: ["chief", "ads", "content"],
    userIds: [],
  },
  {
    id: "prospecting",
    relayId: "f6758067-06e1-4c55-aec8-54377bedc965",
    label: "prospecting",
    description: "Research, leads, and outreach",
    agentIds: ["chief", "prospector"],
    userIds: [],
  },
  {
    id: "marketing",
    relayId: "89ff8a33-24b2-42cc-98ed-0cbb98592ab4",
    label: "marketing",
    description: "Positioning, brand, content, and growth",
    agentIds: ["chief", "brand", "content"],
    userIds: [],
  },
  {
    id: "general",
    relayId: "a842c23b-03fe-42e7-a0bf-1f9687004195",
    label: "general",
    description: "Planning and work across the company",
    agentIds: ["chief"],
    userIds: ["workspace-owner"],
  },
] as const;

export const WORKSPACE_AGENT_IDENTITIES = {
  chief: { name: "Chief", role: "Workspace Lead", color: "#ffffff" },
  setup: { name: "Setup", role: "Private Workspace Setup", color: "#61d9a3" },
  analyst: {
    name: "Analyst",
    role: "Measurement and Reporting",
    color: "#61dbe8",
  },
  ads: { name: "Advertising", role: "Paid Acquisition", color: "#fa8ca8" },
  content: { name: "Content", role: "Content and Creative", color: "#fcc24d" },
  prospector: {
    name: "Prospector",
    role: "Research and Outreach",
    color: "#7dc7fa",
  },
  brand: { name: "Marketer", role: "Marketing", color: "#7adb9e" },
  engineer: { name: "Engineer", role: "Product Engineering", color: "#fa9c57" },
} as const;

export type WorkspaceAgentId = string;
export type StaticWorkspaceAgentId = keyof typeof WORKSPACE_AGENT_IDENTITIES;

export interface WorkspaceAgentIdentity {
  name: string;
  role: string;
  color?: string;
}

export function workspaceAgentIdentity(
  agentId: string,
  agents: readonly { id: string; name: string; role: string }[] = [],
): WorkspaceAgentIdentity {
  const runtime = agents.find((agent) => agent.id === agentId);
  if (runtime) return runtime;
  const known = Object.entries(WORKSPACE_AGENT_IDENTITIES).find(
    ([id]) => id === agentId,
  )?.[1];
  return known ?? { name: agentId, role: "Agent" };
}

/** An agent's name from the workspace roster (including subagents), then the
 * built-in identities. Undefined when neither knows the id. */
export function workspaceAgentName(
  agentId: string,
  agents: readonly {
    id: string;
    name: string;
    subagents?: readonly { id: string; name: string }[];
  }[] = [],
) {
  for (const agent of agents) {
    if (agent.id === agentId) return agent.name;
    const subagent = agent.subagents?.find((child) => child.id === agentId);
    if (subagent) return subagent.name;
  }
  return isWorkspaceAgentId(agentId)
    ? WORKSPACE_AGENT_IDENTITIES[agentId].name
    : undefined;
}

export function isWorkspaceAgentId(
  value: string,
): value is StaticWorkspaceAgentId {
  return Object.hasOwn(WORKSPACE_AGENT_IDENTITIES, value);
}

export type SidebarPinnedItem =
  | { kind: "channel"; id: WorkspaceChannelId }
  | { kind: "agent"; id: WorkspaceAgentId };

export function sidebarPinnedItemKey(item: SidebarPinnedItem) {
  return `${item.kind}:${item.id}`;
}

export function isSidebarPinnedItem(
  value: unknown,
): value is SidebarPinnedItem {
  const item = parseJsonObject(value);
  if (!item) return false;
  if (!isJsonString(item.id)) return false;
  return item.kind === "channel" || item.kind === "agent";
}

export const WORKSPACE_DIRECT_MESSAGES = [
  { id: "chief" },
  { id: "setup" },
  { id: "analyst" },
  { id: "ads" },
  { id: "content" },
  { id: "prospector" },
  { id: "brand" },
  { id: "engineer" },
] as const satisfies readonly { id: WorkspaceAgentId }[];

export type WorkspaceChannelId = string;

export function workspaceChannel(channelId: string | null) {
  return (
    WORKSPACE_CHANNELS.find(
      (channel) => channel.id === channelId || channel.relayId === channelId,
    ) ?? null
  );
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

export function workspaceDirectMessage(
  agentId: string | null,
  agents: readonly {
    id: string;
    subagents?: readonly { id: string }[];
    canMessage?: boolean;
  }[] = [],
) {
  if (!agentId) return null;
  if (agents.length > 0) {
    return agents
      .flatMap((agent) => [agent, ...(agent.subagents ?? [])])
      .some((agent) => agent.id === agentId)
      ? { id: agentId }
      : null;
  }
  return agentId === "chief" ? { id: agentId } : null;
}

export function directMessageChatId(
  agentId: WorkspaceAgentId,
  workspaceId?: string | null,
) {
  return workspaceId ? `dm:${workspaceId}:${agentId}` : `dm:${agentId}`;
}

export function directMessageAgentIdFromChatId(chatId: string | null) {
  if (!chatId?.startsWith("dm:")) return null;
  const agentId = chatId.slice(chatId.lastIndexOf(":") + 1);
  return agentId || null;
}

export function directMessageIdsForChats() {
  return WORKSPACE_DIRECT_MESSAGES.map((message) => message.id);
}

export function directMessageIdsForAgents(
  agents: readonly {
    id: string;
    canMessage?: boolean;
    subagents?: readonly { id: string; canMessage?: boolean }[];
  }[],
) {
  return agents.length > 0
    ? [
        ...new Set(
          agents
            .flatMap((agent) => [agent, ...(agent.subagents ?? [])])
            .filter((agent) => agent.canMessage !== false)
            .map((agent) => agent.id),
        ),
      ]
    : ["chief"];
}

export function directMessageChatForAgent<Chat extends { agent: string }>(
  chats: readonly Chat[],
  agentId: WorkspaceAgentId,
) {
  return chats.find((chat) => chat.agent === agentId) ?? null;
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
