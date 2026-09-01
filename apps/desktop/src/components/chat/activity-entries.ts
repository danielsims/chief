import type { ContentBlock } from "@chief/agent-runtime/types";

type ToolUseBlock = Extract<ContentBlock, { type: "tool_use" }>;
type ToolResultBlock = Extract<ContentBlock, { type: "tool_result" }>;

export interface ActivityToolCall {
  tool: ToolUseBlock;
  result?: ToolResultBlock;
}

export type ActivityEntry =
  | { kind: "reasoning"; key: string; thought: string }
  | { kind: "tool"; key: string; call: ActivityToolCall };

export function activityEntries(
  blocks: readonly ContentBlock[],
): ActivityEntry[] {
  const results = new Map<string, ToolResultBlock>();
  for (const block of blocks) {
    if (block.type === "tool_result") results.set(block.tool_use_id, block);
  }

  const seen = new Set<string>();
  const entries: ActivityEntry[] = [];
  for (const [index, block] of blocks.entries()) {
    if (block.type === "thinking") {
      const thought = block.thinking.trim();
      if (thought) {
        entries.push({ kind: "reasoning", key: `reasoning:${index}`, thought });
      }
      continue;
    }
    if (block.type === "tool_use" && !seen.has(block.id)) {
      seen.add(block.id);
      entries.push({
        kind: "tool",
        key: `tool:${block.id}`,
        call: { tool: block, result: results.get(block.id) },
      });
    }
  }
  return entries;
}
