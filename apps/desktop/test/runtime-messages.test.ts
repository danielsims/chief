import assert from "node:assert/strict";
import test from "node:test";

import type { ChiefUIMessage } from "@chief/agent-runtime/types";

import {
  dropReplayedMessages,
  dropReplayedToolMessages,
  mergeRuntimeHistory,
  mergeRuntimeMessage,
  visibleRuntimeError,
} from "../src/lib/runtime-messages.js";

void test("hides intentional turn cancellation from visible chat errors", () => {
  assert.equal(visibleRuntimeError(" Turn interrupted "), undefined);
  assert.equal(visibleRuntimeError("Turn cancelled"), undefined);
  assert.equal(
    visibleRuntimeError("Browser session failed"),
    "Browser session failed",
  );
});

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

void test("a reconnect snapshot keeps a newer optimistic channel message", () => {
  const optimistic: ChiefUIMessage = {
    id: "new-message",
    role: "user",
    parts: [{ type: "text", text: "@Chief open apple.com" }],
  };
  const older: ChiefUIMessage = {
    id: "older-message",
    role: "assistant",
    parts: [{ type: "text", text: "Earlier reply" }],
  };

  const messages = mergeRuntimeHistory([older, optimistic], [older]);

  assert.deepEqual(
    messages.map((message) => message.id),
    ["older-message", "new-message"],
  );
});

const toolMessage = (
  id: string,
  toolCallId: string,
  threadRootId?: string,
): ChiefUIMessage => ({
  id,
  role: "assistant",
  ...(threadRootId
    ? { metadata: { createdAt: 1, threadRootId } }
    : { metadata: { createdAt: 1 } }),
  parts: [
    {
      type: "dynamic-tool",
      toolCallId,
      toolName: "executor_execute",
      input: { code: "tools.search()" },
      state: "output-available",
      output: "ok",
    },
  ],
});

void test("drops replayed threadless copies that reuse tool call ids", () => {
  const messages = [
    toolMessage("original", "call_x", "root-1"),
    toolMessage("replayed", "call_x"),
  ];

  assert.deepEqual(
    dropReplayedToolMessages(messages).map((m) => m.id),
    ["original"],
  );
});

void test("keeps genuine threadless tool messages with fresh call ids", () => {
  const messages = [
    toolMessage("thread", "call_x", "root-1"),
    toolMessage("main", "call_y"),
  ];

  assert.deepEqual(
    dropReplayedToolMessages(messages).map((m) => m.id),
    ["thread", "main"],
  );
});

void test("thread-attached copies are never treated as replays", () => {
  const messages = [
    toolMessage("first", "call_x", "root-1"),
    toolMessage("second", "call_x", "root-1"),
  ];

  assert.deepEqual(
    dropReplayedToolMessages(messages).map((m) => m.id),
    ["first", "second"],
  );
});

void test("drops identical threadless text copies as replays", () => {
  const messages: ChiefUIMessage[] = [
    { id: "a", role: "assistant", parts: [{ type: "text", text: "Hello" }] },
    { id: "b", role: "assistant", parts: [{ type: "text", text: "Hello" }] },
  ];

  assert.deepEqual(
    dropReplayedToolMessages(messages).map((m) => m.id),
    ["a"],
  );
});

void test("drops replayed threadless text copies but keeps live messages", () => {
  const live: ChiefUIMessage = {
    id: "optimistic",
    role: "user",
    parts: [{ type: "text", text: "@Chief set up GitHub" }],
  };
  const replayed: ChiefUIMessage = {
    id: "replayed",
    role: "assistant",
    parts: [{ type: "text", text: "Checking GitHub." }],
  };
  const original: ChiefUIMessage = {
    id: "original",
    role: "assistant",
    metadata: { createdAt: 1, threadRootId: "root-1" },
    parts: [{ type: "text", text: "Checking GitHub." }],
  };

  const result = dropReplayedMessages([original, replayed, live]);

  assert.deepEqual(
    result.map((m) => m.id),
    ["original", "optimistic"],
  );
});
