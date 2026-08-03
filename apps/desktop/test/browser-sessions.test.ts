import assert from "node:assert/strict";
import test from "node:test";

import type { RuntimeBrowserSession } from "../src/lib/browser-sessions.js";
import {
  anchorBrowserRun,
  anchorBrowserSession,
  beginBrowserActivity,
  completeBrowserActivity,
  completeBrowserRun,
  completeBrowserSession,
  hideBrowserCursor,
  updateBrowserSession,
  upsertBrowserRun,
  upsertBrowserSession,
} from "../src/lib/browser-sessions.js";

function session(conversationId: string): RuntimeBrowserSession {
  return {
    runId: `run-${conversationId}`,
    url: `https://${conversationId}.example`,
    streamUrl: `http://localhost/${conversationId}`,
    conversationId,
    parentConversationId: null,
    workspaceId: "workspace",
    threadRootId: null,
    anchorMessageId: null,
    status: "active",
    operatingLabel: "Browsing",
    operating: true,
    agentCursor: { x: 12, y: 24, visible: true },
  };
}

void test("durable browser runs keep independent historical insertion points", () => {
  const first = {
    id: "run-one",
    workspaceId: "workspace",
    conversationId: "channel",
    url: "https://one.example",
    status: "active" as const,
    createdAt: 1,
    updatedAt: 1,
  };
  const second = {
    ...first,
    id: "run-two",
    url: "https://two.example",
    createdAt: 2,
  };
  const runs = upsertBrowserRun(upsertBrowserRun([], second), first);
  const anchored = anchorBrowserRun(runs, first.id, "message-one");
  const completed = completeBrowserRun(anchored, first.id);

  assert.deepEqual(
    completed.map((run) => run.id),
    ["run-one", "run-two"],
  );
  const [completedFirst, completedSecond] = completed;
  assert.ok(completedFirst);
  assert.ok(completedSecond);
  assert.equal(completedFirst.anchorMessageId, "message-one");
  assert.equal(completedFirst.status, "complete");
  assert.equal(completedSecond.status, "active");

  const resumed = upsertBrowserRun(completed, {
    ...first,
    status: "active",
    updatedAt: 3,
  });
  assert.equal(resumed.length, 2);
  const resumedFirst = resumed[0];
  assert.ok(resumedFirst);
  assert.equal(resumedFirst.id, "run-one");
  assert.equal(resumedFirst.anchorMessageId, "message-one");
  assert.equal(resumedFirst.status, "active");
});

void test("browser sessions remain isolated by owning conversation", () => {
  const channel = session("channel");
  const thread = { ...session("thread"), threadRootId: "root" };
  const sessions = upsertBrowserSession(
    upsertBrowserSession({}, channel),
    thread,
  );
  const updated = updateBrowserSession(sessions, "thread", (current) => ({
    ...current,
    url: "https://updated.example",
  }));

  const updatedThread = updated.thread;
  assert.ok(updatedThread);
  assert.strictEqual(updated.channel, channel);
  assert.equal(updatedThread.url, "https://updated.example");
  assert.equal(updatedThread.threadRootId, "root");
});

void test("closing one browser preserves every other conversation", () => {
  const channel = session("channel");
  const directMessage = session("direct-message");
  const sessions = upsertBrowserSession(
    upsertBrowserSession({}, channel),
    directMessage,
  );
  const completed = completeBrowserSession(sessions, "channel");

  const completedChannel = completed.channel;
  assert.ok(completedChannel);
  assert.equal(completedChannel.status, "complete");
  assert.equal(completedChannel.streamUrl, null);
  assert.equal(completedChannel.agentCursor, null);
  assert.equal(completedChannel.operating, false);
  assert.strictEqual(completed["direct-message"], directMessage);
});

void test("late events for unknown conversations are ignored", () => {
  const sessions = { channel: session("channel") };
  const updated = updateBrowserSession(sessions, "missing", (current) => ({
    ...current,
    url: "https://wrong.example",
  }));

  assert.strictEqual(updated, sessions);
});

void test("a browser keeps its first message insertion point", () => {
  const sessions = { channel: session("channel") };
  const anchored = anchorBrowserSession(sessions, "channel", "message-one");
  const moved = anchorBrowserSession(anchored, "channel", "message-two");

  assert.equal(moved.channel?.anchorMessageId, "message-one");
  assert.strictEqual(moved, anchored);
});

void test("pointing activity preserves the cursor timeline", () => {
  const moving = beginBrowserActivity(session("channel"), {
    label: "Clicking M4 Pro",
    cursor: { x: 0.7, y: 0.4, pressed: false },
  });
  assert.deepEqual(moving.agentCursor, {
    x: 0.7,
    y: 0.4,
    visible: true,
    label: "Chief",
    pressed: false,
    typing: false,
  });

  const clicked = completeBrowserActivity(moving, {
    label: "Clicking M4 Pro",
    cursor: { x: 0.7, y: 0.4, pressed: false },
  });
  assert.ok(clicked.agentCursor);
  assert.equal(clicked.agentCursor.visible, true);
  assert.equal(clicked.agentCursor.pressed, false);
  assert.equal(hideBrowserCursor(clicked).agentCursor?.visible, false);
});

void test("keyboard-only browser activity keeps the last pointer position", () => {
  const keyboard = beginBrowserActivity(session("channel"), {
    label: "Pressing Tab",
  });

  assert.deepEqual(keyboard.agentCursor, session("channel").agentCursor);
});
