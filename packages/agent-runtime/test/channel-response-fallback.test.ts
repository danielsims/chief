import assert from "node:assert/strict";
import test from "node:test";

import { AddressedChannelReplyFallback } from "../src/channel-response-fallback.js";

void test("a successful text-only addressed reply is publishable", () => {
  const fallback = new AddressedChannelReplyFallback();
  const reply = {
    type: "message" as const,
    id: "engineer-reply",
    role: "assistant" as const,
    content: [{ type: "text" as const, text: "What are we building?" }],
  };
  fallback.observe(reply);
  assert.deepEqual(fallback.completed({ type: "result", ok: true }), reply);
});

void test("a useful reply survives later tool failure", () => {
  const withTool = new AddressedChannelReplyFallback();
  withTool.observe({
    type: "message",
    role: "assistant",
    content: [{ type: "text", text: "I'm on it. I found the repository." }],
  });
  withTool.observe({
    type: "message",
    role: "assistant",
    content: [{ type: "tool_use", id: "tool-1", name: "search", input: {} }],
  });
  assert.deepEqual(withTool.completed({ type: "error", message: "stalled" }), {
    type: "message",
    role: "assistant",
    content: [{ type: "text", text: "I'm on it. I found the repository." }],
  });
});

void test("an explicit channel publication is never duplicated", () => {
  const fallback = new AddressedChannelReplyFallback();
  fallback.observe({
    type: "message",
    role: "assistant",
    content: [{ type: "text", text: "The durable result is ready." }],
  });
  fallback.observe({
    type: "message",
    role: "assistant",
    content: [
      {
        type: "tool_use",
        id: "publish-1",
        name: "chief local localTools channelsMessagesPost",
        input: {},
      },
    ],
  });
  assert.equal(fallback.completed({ type: "result", ok: true }), undefined);
});

void test("a successful tool-assisted turn must use the channel message tool", () => {
  const fallback = new AddressedChannelReplyFallback();
  fallback.observe({
    type: "message",
    role: "assistant",
    content: [{ type: "tool_use", id: "tool-1", name: "search", input: {} }],
  });
  fallback.observe({
    type: "message",
    role: "assistant",
    content: [
      { type: "thinking", thinking: "private reasoning" },
      { type: "text", text: "I found and fixed the routing issue." },
    ],
  });
  assert.equal(fallback.completed({ type: "result", ok: true }), undefined);
});
