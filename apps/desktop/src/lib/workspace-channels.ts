import type { LocalChatSummary } from "./runtime";

export const WORKSPACE_CHANNELS = [
  {
    id: "analytics",
    label: "analytics",
    description: "Measurement, reporting, and performance",
  },
  {
    id: "advertising",
    label: "advertising",
    description: "Campaigns, creative, and acquisition",
  },
  {
    id: "prospecting",
    label: "prospecting",
    description: "Research, leads, and outreach",
  },
  {
    id: "general",
    label: "general",
    description: "Planning and work across the company",
  },
] as const;

export type WorkspaceChannelId = (typeof WORKSPACE_CHANNELS)[number]["id"];

const CHANNEL_KEYWORDS: {
  id: Exclude<WorkspaceChannelId, "general">;
  keywords: string[];
}[] = [
  {
    id: "analytics",
    keywords: [
      "analytics",
      "report",
      "performance",
      "traffic",
      "conversion",
      "measurement",
    ],
  },
  {
    id: "advertising",
    keywords: [
      "advertising",
      "campaign",
      "content",
      "marketing",
      "launch",
      "creative",
      "ad ",
    ],
  },
  {
    id: "prospecting",
    keywords: [
      "prospect",
      "lead",
      "outreach",
      "customer",
      "buyer",
      "market research",
    ],
  },
];

export function channelForText(value: string): WorkspaceChannelId {
  const searchable = value.toLocaleLowerCase();
  return (
    CHANNEL_KEYWORDS.find((channel) =>
      channel.keywords.some((keyword) => searchable.includes(keyword)),
    )?.id ?? "general"
  );
}

export function channelForChat(chat: LocalChatSummary): WorkspaceChannelId {
  return channelForText(`${chat.title} ${chat.lastText}`);
}

export function workspaceChannel(channelId: string | null) {
  return WORKSPACE_CHANNELS.find((channel) => channel.id === channelId) ?? null;
}
