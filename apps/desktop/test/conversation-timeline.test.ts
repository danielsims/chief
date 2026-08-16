import assert from "node:assert/strict";
import test from "node:test";

import type {
  ActionItem,
  ChiefUIMessage,
  SessionRecord,
} from "@chief/agent-runtime/types";

import {
  conversationTimelineEntries,
  withActionTimelineEntries,
  withSpecialistTimelineEntries,
} from "../src/components/chat/conversation-timeline-entries.js";

void test("channel threads contain authored replies before specialist projection", () => {
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

void test("a specialist task remains in its owning thread after failure", () => {
  const messages = [
    {
      id: "failure",
      role: "assistant",
      parts: [{ type: "text", text: "I could not finish this run." }],
      metadata: { createdAt: 300, threadRootId: "root" },
    },
  ] as ChiefUIMessage[];
  const task = {
    id: "prospecting-run",
    parentId: "channel:workspace:prospecting",
    kind: "task",
    visibility: "private",
    agent: "prospector",
    title: "Find buying signals",
    provider: "codex",
    status: "failed",
    attempt: 1,
    createdAt: 200,
    updatedAt: 300,
  } as SessionRecord;

  const entries = withSpecialistTimelineEntries(
    conversationTimelineEntries(messages, [], new Map(), "root"),
    [task],
  );

  assert.deepEqual(
    entries.map((entry) => entry.type),
    ["specialist", "message"],
  );
  assert.equal(
    entries[0]?.type === "specialist" && entries[0].task.id,
    task.id,
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

void test("an answered action stays before the continuation reply it triggered", () => {
  const messages = [
    {
      id: "request",
      role: "user",
      parts: [{ type: "text", text: "Set an action item." }],
      metadata: { createdAt: 100 },
    },
    {
      id: "continuation",
      role: "assistant",
      parts: [{ type: "text", text: "Thanks, I continued the work." }],
      metadata: { createdAt: 300 },
    },
  ] as ChiefUIMessage[];
  const action = {
    id: "action",
    agentId: "chief",
    title: "Choose one",
    reason: "One decision is needed.",
    status: "resolved",
    createdAt: 200,
  } as ActionItem;

  const entries = withActionTimelineEntries(
    conversationTimelineEntries(messages, [], new Map(), null),
    [action],
  );

  assert.deepEqual(
    entries.map((entry) =>
      entry.type === "message" ? entry.message.id : entry.type,
    ),
    ["request", "action", "continuation"],
  );
});
