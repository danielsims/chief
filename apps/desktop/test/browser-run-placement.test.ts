import assert from "node:assert/strict";
import test from "node:test";

import type { BrowserRunRecord } from "@chief/agent-runtime/types";

import { resolveBrowserRunAnchors } from "../src/components/chat/browser-run-placement.ts";

const run = (
  id: string,
  createdAt: number,
  extra: Partial<BrowserRunRecord> = {},
): BrowserRunRecord => ({
  id,
  workspaceId: "workspace",
  conversationId: "conversation",
  url: `https://${id}.example`,
  status: "complete",
  createdAt,
  updatedAt: createdAt,
  ...extra,
});

void test("fresh browser runs get distinct anchors in one DM", () => {
  const anchors = resolveBrowserRunAnchors(
    [run("old", 1), run("fresh", 2, { status: "active" })],
    [
      {
        id: "open-old",
        role: "assistant",
        threadRootId: null,
        isBrowserOpen: true,
        createdAt: 0.9,
      },
      {
        id: "reply-old",
        role: "assistant",
        threadRootId: null,
        isBrowserOpen: false,
        createdAt: 1.2,
      },
      {
        id: "open-fresh",
        role: "assistant",
        threadRootId: null,
        isBrowserOpen: true,
        createdAt: 1.9,
      },
    ],
  );

  assert.equal(anchors.get("old"), "open-old");
  assert.equal(anchors.get("fresh"), "open-fresh");
});

void test("main chat and thread browsers cannot steal each other's anchors", () => {
  const anchors = resolveBrowserRunAnchors(
    [run("main", 1), run("thread", 2, { threadRootId: "root" })],
    [
      {
        id: "main-open",
        role: "assistant",
        threadRootId: null,
        isBrowserOpen: true,
        createdAt: 0.9,
      },
      {
        id: "thread-open",
        role: "assistant",
        threadRootId: "root",
        isBrowserOpen: true,
        createdAt: 1.9,
      },
    ],
  );

  assert.equal(anchors.get("main"), "main-open");
  assert.equal(anchors.get("thread"), "thread-open");
});

void test("durable anchors stay immutable when a newer browser opens", () => {
  const anchors = resolveBrowserRunAnchors(
    [
      run("old", 1, { anchorMessageId: "old-owner" }),
      run("fresh", 2, { status: "active" }),
    ],
    [
      {
        id: "old-owner",
        role: "assistant",
        threadRootId: null,
        isBrowserOpen: true,
        createdAt: 0.9,
      },
      {
        id: "fresh-owner",
        role: "assistant",
        threadRootId: null,
        isBrowserOpen: true,
        createdAt: 1.9,
      },
    ],
    { old: "fresh-owner", fresh: "fresh-owner" },
  );

  assert.equal(anchors.get("old"), "old-owner");
  assert.equal(anchors.get("fresh"), "fresh-owner");
});

void test("a completed run keeps its place when a later user message arrives", () => {
  const browserRun = run("handoff", 20, {
    anchorMessageId: "duplicate-old-anchor",
  });
  const candidates = [
    {
      id: "duplicate-old-anchor",
      role: "assistant",
      threadRootId: null,
      isBrowserOpen: true,
      createdAt: 10,
    },
    {
      id: "handoff-tool",
      role: "assistant",
      threadRootId: null,
      isBrowserOpen: false,
      createdAt: 19,
    },
  ];
  const initial = resolveBrowserRunAnchors(
    [run("older", 11, { anchorMessageId: "duplicate-old-anchor" }), browserRun],
    candidates,
  );
  const afterReply = resolveBrowserRunAnchors(
    [run("older", 11, { anchorMessageId: "duplicate-old-anchor" }), browserRun],
    [
      ...candidates,
      {
        id: "later-user-message",
        role: "user",
        threadRootId: null,
        isBrowserOpen: false,
        createdAt: 30,
      },
    ],
  );

  assert.equal(initial.get("handoff"), "handoff-tool");
  assert.equal(afterReply.get("handoff"), "handoff-tool");
});

void test("a reopened browser cannot attach before the user turn that opened it", () => {
  const anchors = resolveBrowserRunAnchors(
    [
      run("previous", 10, { anchorMessageId: "previous-open" }),
      run("reopened", 22, {
        status: "active",
        anchorMessageId: "previous-tool",
      }),
    ],
    [
      {
        id: "previous-open",
        role: "assistant",
        threadRootId: null,
        isBrowserOpen: false,
        createdAt: 9,
      },
      {
        id: "previous-tool",
        role: "assistant",
        threadRootId: null,
        isBrowserOpen: true,
        createdAt: 10,
      },
      {
        id: "try-again",
        role: "user",
        threadRootId: null,
        isBrowserOpen: false,
        createdAt: 20,
      },
      {
        id: "current-opening-line",
        role: "assistant",
        threadRootId: null,
        isBrowserOpen: false,
        createdAt: 21,
      },
    ],
  );

  assert.equal(anchors.get("previous"), "previous-open");
  assert.equal(anchors.get("reopened"), "current-opening-line");
});
