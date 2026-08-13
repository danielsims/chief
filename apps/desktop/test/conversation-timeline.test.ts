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

void test("a specialist file card stays in its owning thread", () => {
  const fileMessage = {
    id: "specialist-file:brand-profile:version-1",
    role: "assistant",
    parts: [
      {
        type: "data-document",
        id: "document-brand-profile-version-1",
        data: {
          fileId: "brand-profile",
          title: "Working brand profile.md",
          path: "brand/working-brand-profile.md",
          kind: "document",
          versionId: "version-1",
        },
      },
    ],
    metadata: { createdAt: 200, threadRootId: "brand-thread" },
  } as ChiefUIMessage;

  assert.equal(
    conversationTimelineEntries([fileMessage], [], new Map(), null).length,
    0,
  );
  const threadEntries = conversationTimelineEntries(
    [fileMessage],
    [],
    new Map(),
    "brand-thread",
  );
  assert.equal(threadEntries.length, 1);
  assert.equal(
    threadEntries[0]?.type === "message" && threadEntries[0].message.id,
    fileMessage.id,
  );
});
