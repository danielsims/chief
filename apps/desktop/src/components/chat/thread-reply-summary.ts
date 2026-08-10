import type { ContentBlock } from "@chief/agent-runtime/types";

const BROWSER_OPERATIONS = new Set([
  "click",
  "fill",
  "open",
  "press",
  "select",
  "snapshot",
]);

export function isBrowserInteraction(block: ContentBlock) {
  if (block.type !== "tool_use") return false;
  const segments = block.name
    .replace(/([a-z0-9])([A-Z])/gu, "$1_$2")
    .toLowerCase()
    .split(/[^a-z0-9]+/u);
  const browserIndex = segments.lastIndexOf("browser");
  return (
    browserIndex >= 0 &&
    segments
      .slice(browserIndex + 1)
      .some((segment) => BROWSER_OPERATIONS.has(segment))
  );
}

export function hasBrowserInteraction(blocks: readonly ContentBlock[]) {
  return blocks.some(isBrowserInteraction);
}

export function hasVisibleThreadContent(blocks: readonly ContentBlock[]) {
  return blocks.some((block) => {
    if (block.type === "text") return Boolean(block.text.trim());
    if (block.type === "thinking" || block.type === "tool_result") return false;
    return !isBrowserInteraction(block);
  });
}

export interface ThreadReplyCandidate {
  role: "system" | "user" | "assistant";
  createdAt?: number;
  blocks: readonly ContentBlock[];
  visibleBlocks: readonly ContentBlock[];
}

export function summarizeThreadReplyCandidates(
  replies: readonly ThreadReplyCandidate[],
) {
  let browserReplyCount = 0;
  let lastReplyAt: number | undefined;
  const visibleIndexes: number[] = [];

  replies.forEach((reply, index) => {
    if (hasBrowserInteraction(reply.blocks)) {
      browserReplyCount = 1;
      lastReplyAt = Math.max(lastReplyAt ?? 0, reply.createdAt ?? 0);
    }
    const visible =
      reply.role === "user" ||
      (reply.role === "assistant" &&
        hasVisibleThreadContent(reply.visibleBlocks));
    if (!visible) return;
    visibleIndexes.push(index);
    lastReplyAt = Math.max(lastReplyAt ?? 0, reply.createdAt ?? 0);
  });

  return {
    count: visibleIndexes.length + browserReplyCount,
    lastReplyAt,
    visibleIndexes,
  };
}
