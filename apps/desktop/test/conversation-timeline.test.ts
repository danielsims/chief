import assert from "node:assert/strict";
import test from "node:test";

import type { ChiefUIMessage } from "@chief/agent-runtime/types";

import { conversationTimelineEntries } from "../src/components/chat/conversation-timeline-entries.js";

void test("channel threads contain authored replies without private specialist cards", () => {
  const messages = [
    {
      id: "root",
      role: "assistant",
      parts: [{ type: "text", text: "Starting the connection now." }],
      metadata: { createdAt: 100 },
    },
    {
      id: "reply",
      role: "assistant",
      parts: [{ type: "text", text: "Sign-in is ready when you are." }],
      metadata: { createdAt: 200, threadRootId: "root" },
    },
  ] as ChiefUIMessage[];

  const entries = conversationTimelineEntries(messages, [], new Map(), "root");

  assert.deepEqual(
    entries.map((entry) => entry.type),
    ["message"],
  );
  assert.equal(
    entries[0]?.type === "message" && entries[0].message.id,
    "reply",
  );
});
