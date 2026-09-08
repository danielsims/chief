import assert from "node:assert/strict";
import test from "node:test";

import { activityEntries } from "../src/components/chat/activity-entries.ts";

void test("activity preserves reasoning and tool calls in execution order", () => {
  const entries = activityEntries([
    { type: "thinking", thinking: "Inspect the workspace." },
    { type: "tool_use", id: "list", name: "list", input: {} },
    { type: "tool_result", tool_use_id: "list", content: "done" },
    { type: "thinking", thinking: "The first result changes the next step." },
    { type: "tool_use", id: "read", name: "read", input: {} },
  ]);

  assert.deepEqual(
    entries.map((entry) =>
      entry.kind === "reasoning"
        ? [entry.kind, entry.thought]
        : [entry.kind, entry.call.tool.id, Boolean(entry.call.result)],
    ),
    [
      ["reasoning", "Inspect the workspace."],
      ["tool", "list", true],
      ["reasoning", "The first result changes the next step."],
      ["tool", "read", false],
    ],
  );
});
