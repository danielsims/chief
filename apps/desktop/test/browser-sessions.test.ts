import assert from "node:assert/strict";
import test from "node:test";

import type { RuntimeBrowserSession } from "../src/lib/browser-sessions.js";
import {
  anchorBrowserRun,
  anchorBrowserSession,
  beginBrowserActivity,
  browserOpenResultContent,
  browserRunBelongsToChat,
  completeBrowserActivity,
  completeBrowserRun,
  completeBrowserSession,
  hideBrowserCursor,
  mergeBrowserRunSnapshot,
  presentBrowserSession,
  projectBrowserRunToOwnedThread,
  resolveBrowserOwnerMessageId,
  updateBrowserSession,
  upsertBrowserRun,
  upsertBrowserSession,
} from "../src/lib/browser-sessions.js";

function session(
  conversationId: string,
  runId = `run-${conversationId}`,
): RuntimeBrowserSession {
  return {
    runId,
    url: `https://${conversationId}.example`,
    streamUrl: `http://localhost/${conversationId}`,
    conversationId,
    parentConversationId: null,
    workspaceId: "workspace",
    threadRootId: null,
    anchorMessageId: null,
    status: "active",
    createdAt: 1,
    presentation: "inline",
    presentationRevision: 0,
    operatingLabel: "Browsing",
    operating: true,
    agentCursor: { x: 12, y: 24, visible: true },
  };
}

void test("closing an old run cannot close a fresh run in the same DM", () => {
  const old = session("setup", "run-old");
  const fresh = { ...session("setup", "run-fresh"), createdAt: 2 };
  const sessions = upsertBrowserSession(upsertBrowserSession({}, old), fresh);
  const completed = completeBrowserSession(sessions, old.runId);

  assert.equal(completed[old.runId]?.status, "complete");
  assert.equal(completed[fresh.runId]?.status, "active");
  assert.equal(completed[fresh.runId]?.streamUrl, fresh.streamUrl);
});

void test("an explicit presentation changes only the addressed browser run", () => {
  const first = session("setup", "run-first");
  const second = session("setup", "run-second");
  const sessions = upsertBrowserSession(
    upsertBrowserSession({}, first),
    second,
  );
  const presented = presentBrowserSession(
    sessions,
    second.runId,
    "picture-in-picture",
  );

  assert.equal(presented[first.runId]?.presentation, "inline");
  assert.equal(presented[first.runId]?.presentationRevision, 0);
  assert.equal(presented[second.runId]?.presentation, "picture-in-picture");
  assert.equal(presented[second.runId]?.presentationRevision, 1);
});

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

void test("a live browser can gain thread ownership but never drift to another thread", () => {
  const initial = {
    id: "run-setup",
    workspaceId: "workspace",
    conversationId: "mission-control",
    url: "https://accounts.google.com",
    status: "active" as const,
    createdAt: 1,
    updatedAt: 1,
  };
  const owned = upsertBrowserRun([initial], {
    ...initial,
    conversationId: "specialist-setup",
    threadRootId: "setup-thread",
    updatedAt: 2,
  });
  const unchanged = upsertBrowserRun(owned, {
    ...initial,
    conversationId: "specialist-setup",
    threadRootId: "setup-thread-alias",
    updatedAt: 3,
  });

  const [run] = unchanged;
  assert.ok(run);
  assert.equal(run.conversationId, "specialist-setup");
  assert.equal(run.threadRootId, "setup-thread");
});

void test("a reconnect snapshot cannot move a mounted browser to a thread alias", () => {
  const current = {
    id: "run-setup",
    workspaceId: "workspace",
    conversationId: "specialist-setup",
    threadRootId: "setup-thread",
    url: "https://accounts.google.com",
    status: "active" as const,
    createdAt: 1,
    updatedAt: 1,
  };
  const [merged] = mergeBrowserRunSnapshot(
    [current],
    [
      {
        ...current,
        threadRootId: "setup-thread-alias",
        updatedAt: 2,
      },
    ],
  );

  assert.equal(merged?.threadRootId, "setup-thread");
});

void test("live browser broadcasts preserve their first concrete thread", () => {
  const topLevel = session("mission-control", "setup-run");
  const owned = upsertBrowserSession(
    { [topLevel.runId]: topLevel },
    {
      ...topLevel,
      conversationId: "specialist-setup",
      threadRootId: "setup-thread",
    },
  );
  const drifted = upsertBrowserSession(owned, {
    ...topLevel,
    conversationId: "specialist-setup",
    threadRootId: "setup-thread-alias",
  });

  assert.equal(drifted[topLevel.runId]?.conversationId, "specialist-setup");
  assert.equal(drifted[topLevel.runId]?.threadRootId, "setup-thread");
});

void test("browser sessions remain isolated by owning conversation", () => {
  const channel = session("channel");
  const thread = { ...session("thread"), threadRootId: "root" };
  const sessions = upsertBrowserSession(
    upsertBrowserSession({}, channel),
    thread,
  );
  const updated = updateBrowserSession(sessions, thread.runId, (current) => ({
    ...current,
    url: "https://updated.example",
  }));

  const updatedThread = updated[thread.runId];
  assert.ok(updatedThread);
  assert.strictEqual(updated[channel.runId], channel);
  assert.equal(updatedThread.url, "https://updated.example");
  assert.equal(updatedThread.threadRootId, "root");
});

void test("a private child browser projects into its parent chat", () => {
  const run = {
    id: "setup-browser",
    workspaceId: "workspace",
    conversationId: "specialist-setup",
    url: "https://accounts.google.com/",
    status: "active" as const,
    createdAt: 1,
    updatedAt: 1,
  };
  assert.equal(
    browserRunBelongsToChat(
      run,
      "mission-control",
      new Set(["specialist-setup"]),
    ),
    true,
  );
  assert.equal(browserRunBelongsToChat(run, "other-channel", new Set()), false);
  assert.equal(
    projectBrowserRunToOwnedThread(
      run,
      "visible-setup-thread",
      new Set(["specialist-setup"]),
    ).threadRootId,
    "visible-setup-thread",
  );
});

void test("closing one browser preserves every other conversation", () => {
  const channel = session("channel");
  const directMessage = session("direct-message");
  const sessions = upsertBrowserSession(
    upsertBrowserSession({}, channel),
    directMessage,
  );
  const completed = completeBrowserSession(sessions, channel.runId);

  const completedChannel = completed[channel.runId];
  assert.ok(completedChannel);
  assert.equal(completedChannel.status, "complete");
  assert.equal(completedChannel.streamUrl, null);
  assert.equal(completedChannel.agentCursor, null);
  assert.equal(completedChannel.operating, false);
  assert.strictEqual(completed[directMessage.runId], directMessage);
});

void test("late events for unknown conversations are ignored", () => {
  const channel = session("channel");
  const sessions = { [channel.runId]: channel };
  const updated = updateBrowserSession(sessions, "missing", (current) => ({
    ...current,
    url: "https://wrong.example",
  }));

  assert.strictEqual(updated, sessions);
});

void test("a browser keeps its first message insertion point", () => {
  const channel = session("channel");
  const sessions = { [channel.runId]: channel };
  const anchored = anchorBrowserSession(sessions, channel.runId, "message-one");
  const moved = anchorBrowserSession(anchored, channel.runId, "message-two");

  assert.equal(moved[channel.runId]?.anchorMessageId, "message-one");
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

void test("browser owner matches the session thread, not the first open", () => {
  const candidates = [
    {
      id: "main-open",
      role: "assistant",
      threadRootId: null,
      isBrowserOpen: true,
    },
    {
      id: "thread-reply",
      role: "assistant",
      threadRootId: "root",
      isBrowserOpen: true,
    },
    {
      id: "thread-text",
      role: "assistant",
      threadRootId: "root",
      isBrowserOpen: false,
    },
  ];

  assert.equal(
    resolveBrowserOwnerMessageId(candidates, "root"),
    "thread-reply",
  );
  assert.equal(resolveBrowserOwnerMessageId(candidates, null), "main-open");
});

void test("browser owner prefers a durable anchor that still exists", () => {
  const candidates = [
    {
      id: "main-open",
      role: "assistant",
      threadRootId: null,
      isBrowserOpen: true,
    },
    {
      id: "thread-reply",
      role: "assistant",
      threadRootId: "root",
      isBrowserOpen: true,
    },
  ];

  assert.equal(
    resolveBrowserOwnerMessageId(candidates, "root", "main-open"),
    "main-open",
  );
  // A stale anchor (message no longer present) falls back to thread resolution.
  assert.equal(
    resolveBrowserOwnerMessageId(candidates, "root", "missing"),
    "thread-reply",
  );
});

void test("newest browser-open message wins within the matching thread", () => {
  const candidates = [
    {
      id: "older",
      role: "assistant",
      threadRootId: "root",
      isBrowserOpen: true,
    },
    {
      id: "newer",
      role: "assistant",
      threadRootId: "root",
      isBrowserOpen: true,
    },
  ];

  assert.equal(resolveBrowserOwnerMessageId(candidates, "root"), "newer");
});

void test("no open call means no owner message", () => {
  const candidates = [
    {
      id: "text-only",
      role: "assistant",
      threadRootId: null,
      isBrowserOpen: false,
    },
    { id: "user-open", role: "user", threadRootId: null, isBrowserOpen: true },
  ];

  assert.equal(resolveBrowserOwnerMessageId(candidates, null), undefined);
});

void test("detects browserOpen from an executor tool result", () => {
  assert.equal(
    browserOpenResultContent(
      '{\n  "ok": true,\n  "data": { "opened": true, "url": "https://program.video/" }\n}',
    ),
    true,
  );
});

void test("does not treat snapshots or clicks as browser opens", () => {
  assert.equal(
    browserOpenResultContent(
      '{"ok": true, "data": { "url": "https://program.video/", "title": "Home", "controls": [] }}',
    ),
    false,
  );
  assert.equal(
    browserOpenResultContent(
      '{"ok": true, "data": { "clicked": true, "url": "https://program.video/" }}',
    ),
    false,
  );
  assert.equal(browserOpenResultContent(undefined), false);
  assert.equal(browserOpenResultContent("unrelated output"), false);
});
