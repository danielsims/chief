import type { LocalChatSummary } from "./runtime";

export type ChannelSectionId =
  "analytics" | "campaigns" | "prospects" | "general";

const SECTION_KEYWORDS: {
  id: Exclude<ChannelSectionId, "general">;
  keywords: string[];
}[] = [
  {
    id: "analytics",
    keywords: ["analytics", "report", "performance", "traffic", "conversion"],
  },
  {
    id: "campaigns",
    keywords: ["campaign", "content", "marketing", "launch", "draft", "post"],
  },
  {
    id: "prospects",
    keywords: ["prospect", "lead", "outreach", "customer", "buyer", "market"],
  },
];

export function classifyChannel(chat: LocalChatSummary): ChannelSectionId {
  const searchable = `${chat.title} ${chat.lastText}`.toLocaleLowerCase();
  return (
    SECTION_KEYWORDS.find((section) =>
      section.keywords.some((keyword) => searchable.includes(keyword)),
    )?.id ?? "general"
  );
}
