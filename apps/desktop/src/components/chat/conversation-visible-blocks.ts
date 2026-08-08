import type { ContentBlock } from "@chief/agent-runtime/types";

/**
 * Keep the conversation authored and calm. Runtime reasoning and ordinary tool
 * telemetry belong in Activity; rich generated artifacts remain in the chat.
 */
export function conversationVisibleBlocks(blocks: ContentBlock[]) {
  return blocks.filter(
    (block) =>
      block.type !== "thinking" &&
      block.type !== "tool_result" &&
      block.type !== "tool_use",
  );
}
