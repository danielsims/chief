import assert from "node:assert/strict";
import test from "node:test";

import type { ChiefUIMessage } from "@chief/agent-runtime/types";

import { mergeRuntimeMessage } from "../src/lib/runtime-messages.js";

const streamed = (text: string): ChiefUIMessage => ({
  id: "stream:chat",
  role: "assistant",
  parts: [{ type: "text", text, state: "streaming" }],
});

void test("preserves a complete stream when persistence is truncated", () => {
  const messages = mergeRuntimeMessage([streamed("Complete response")], {
    id: "durable",
    role: "assistant",
    parts: [{ type: "text", text: "Complete" }],
  });

  assert.equal(messages.length, 1);
  assert.equal(messages[0]?.id, "durable");
  assert.deepEqual(messages[0].parts, [
    { type: "text", text: "Complete response" },
  ]);
});

void test("keeps streamed commentary before a tool-only message", () => {
  const messages = mergeRuntimeMessage([streamed("Checking Google now.")], {
    id: "tool",
    role: "assistant",
    parts: [
      {
        type: "tool-browser",
        toolCallId: "call",
        state: "input-available",
        input: {},
      },
    ],
  });

  assert.equal(messages.length, 2);
  assert.equal(messages[0]?.id, "stream:chat:before:tool");
  assert.equal(messages[1]?.id, "tool");
});
