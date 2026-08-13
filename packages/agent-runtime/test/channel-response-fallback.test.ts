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

void test("tool-using and failed turns never auto-publish narration", () => {
  const withTool = new AddressedChannelReplyFallback();
  withTool.observe({
    type: "message",
    role: "assistant",
    content: [{ type: "text", text: "Let me inspect that." }],
  });
  withTool.observe({
    type: "message",
    role: "assistant",
    content: [{ type: "tool_use", id: "tool-1", name: "search", input: {} }],
  });
  assert.equal(withTool.completed({ type: "result", ok: true }), undefined);

  const failed = new AddressedChannelReplyFallback();
  failed.observe({
    type: "message",
    role: "assistant",
    content: [{ type: "text", text: "A partial reply." }],
  });
  assert.equal(failed.completed({ type: "result", ok: false }), undefined);
});
