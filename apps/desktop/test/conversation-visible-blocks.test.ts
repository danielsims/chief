import assert from "node:assert/strict";
import test from "node:test";

import type { ContentBlock } from "@chief/agent-runtime/types";

import { conversationVisibleBlocks } from "../src/components/chat/conversation-visible-blocks.ts";

void test("DM transcripts keep authored content and move runtime telemetry to Activity", () => {
  const blocks: ContentBlock[] = [
    { type: "text", text: "The audit is complete. I’m running checks next." },
    { type: "thinking", thinking: "Private reasoning" },
    {
      type: "tool_use",
      id: "tool-1",
      name: "bash",
      input: { command: "pnpm test" },
    },
    {
      type: "tool_result",
      tool_use_id: "tool-1",
      content: "passed",
    },
    {
      type: "data-chart",
      data: {
        kind: "line",
        title: "Traffic",
        yLabel: "Visits",
        series: [],
      },
    },
  ];

  const visible = conversationVisibleBlocks(blocks);

  assert.deepEqual(
    visible.map((block) => block.type),
    ["text", "data-chart"],
  );
});
