import assert from "node:assert/strict";
import test from "node:test";

import type { AgentBrowserSession } from "@chief/browser/node";

import {
  BrowserSessionRegistry,
  browserThreadRoot,
  commandTargetsActiveBrowserRun,
  legacyGoogleAuthBrowserOwner,
  repairLegacyGoogleAuthBrowserOwners,
  resumableBrowserRuns,
} from "../src/browser-session-registry.js";

void test("a specialist browser inherits its durable channel thread", () => {
  assert.equal(
    browserThreadRoot(undefined, undefined, {
      threadRootId: "prospector-thread",
    }),
    "prospector-thread",
  );
  assert.equal(
    browserThreadRoot("explicit-thread", undefined, {
      threadRootId: "prospector-thread",
    }),
    "explicit-thread",
  );
});

void test("a stale browser control cannot target the replacement run", () => {
  assert.equal(commandTargetsActiveBrowserRun("fresh", "old"), false);
  assert.equal(commandTargetsActiveBrowserRun("fresh", "fresh"), true);
  assert.equal(commandTargetsActiveBrowserRun(undefined, "old"), false);
});

void test("keeps every active browser run independently resumable", () => {
  const run = (
    id: string,
    conversationId: string,
    createdAt: number,
    status: "active" | "complete",
  ) => ({
    id,
    workspaceId: "workspace",
    conversationId,
    url: "https://example.com",
    status,
    createdAt,
    updatedAt: createdAt,
  });
  assert.deepEqual(
    resumableBrowserRuns([
      run("old", "chat-a", 1, "active"),
      run("new", "chat-a", 2, "active"),
      run("complete", "chat-b", 3, "complete"),
      run("other", "chat-c", 4, "active"),
    ]).map((candidate) => candidate.id),
    ["old", "new", "other"],
  );
});

void test("repairs one legacy Google handoff into its Setup thread", () => {
  const run = {
    id: "browser",
    workspaceId: "workspace",
    conversationId: "mission-control",
    url: "https://accounts.google.com/v3/signin/identifier",
    status: "active" as const,
    createdAt: 20,
    updatedAt: 20,
  };
  assert.deepEqual(
    legacyGoogleAuthBrowserOwner(run, [
      {
        id: "setup-child",
        agent: "setup",
        parentId: "mission-control",
        status: "waiting",
        triggerContext: { threadRootId: "setup-thread" },
        createdAt: 10,
      },
    ]),
    { conversationId: "setup-child", threadRootId: "setup-thread" },
  );
  assert.equal(
    legacyGoogleAuthBrowserOwner(run, [
      {
        id: "setup-one",
        agent: "setup",
        parentId: "mission-control",
        status: "waiting",
        triggerContext: { threadRootId: "thread-one" },
        createdAt: 10,
      },
      {
        id: "setup-two",
        agent: "setup",
        parentId: "mission-control",
        status: "running",
        triggerContext: { threadRootId: "thread-two" },
        createdAt: 11,
      },
    ]),
    undefined,
  );
});

void test("canonicalizes a recovered browser to the visible channel root", async () => {
  const updates: unknown[] = [];
  const stateUpdates: unknown[] = [];
  const [repaired] = await repairLegacyGoogleAuthBrowserOwners(
    {
      channelStore: () => ({
        events: () =>
          Promise.resolve([
            {
              id: "protocol-root",
              tags: [["client", "channel-api:onboarding-setup-thread"]],
            },
          ]),
      }),
      chatRecord: () =>
        Promise.resolve({
          id: "specialist-setup",
          agent: "setup",
          parentId: "channel:workspace:mission-control",
          status: "failed",
          summary: "Google sign-in is open. pending-human-signin",
          triggerContext: { threadRootId: "protocol-root" },
          createdAt: 1,
        }),
      listChildChats: () => Promise.resolve([]),
      updateChatState: (_workspaceId, _chatId, state) => {
        stateUpdates.push(state);
        return Promise.resolve(true);
      },
      updateBrowserRun: (_workspaceId, _id, patch) => {
        updates.push(patch);
        return Promise.resolve();
      },
    },
    "workspace",
    [
      {
        id: "browser",
        workspaceId: "workspace",
        conversationId: "specialist-setup",
        parentConversationId: "channel:workspace:mission-control",
        threadRootId: "protocol-root",
        url: "https://accounts.google.com/",
        status: "active",
        createdAt: 1,
        updatedAt: 1,
      },
    ],
  );
  assert.equal(repaired?.threadRootId, "channel-api:onboarding-setup-thread");
  assert.equal(updates.length, 1);
  assert.deepEqual(stateUpdates, [
    { status: "waiting", finishedAt: null, error: null },
  ]);
});

void test("creates independent physical sessions for independent run ids", () => {
  const created: string[] = [];
  const registry = new BrowserSessionRegistry((_workspaceId, browserRunId) => {
    created.push(browserRunId);
    return {
      id: browserRunId,
      close: () => Promise.resolve(),
      clearSavedState: () => Promise.resolve(),
      setViewport: () => Promise.resolve(),
    };
  });
  const first = registry.session("workspace", "browser-run-a");
  const second = registry.session("workspace", "browser-run-b");
  assert.notEqual(first, second);
  assert.deepEqual(created, ["browser-run-a", "browser-run-b"]);
});

void test("reset closes a browser and clears only its saved state", async () => {
  const calls: string[] = [];
  const session = {
    close: () => {
      calls.push("close");
      return Promise.resolve();
    },
    clearSavedState: () => {
      calls.push("clear");
      return Promise.resolve();
    },
    setViewport: () => Promise.resolve(),
  };
  const registry = new BrowserSessionRegistry(() => session);
  registry.session("workspace", "conversation");
  await registry.reset("workspace", "conversation");
  assert.deepEqual(calls, ["close", "clear"]);
});

void test("deduplicates an already applied browser viewport", async () => {
  const viewports: [number, number][] = [];
  const session = {
    close: () => Promise.resolve(),
    clearSavedState: () => Promise.resolve(),
    setViewport: (width: number, height: number) => {
      viewports.push([width, height]);
      return Promise.resolve();
    },
  };
  const registry = new BrowserSessionRegistry(() => session);

  await registry.resize("workspace", "conversation", {
    width: 700,
    height: 1_021,
  });
  await registry.resize("workspace", "conversation", {
    width: 700,
    height: 1_021,
  });

  assert.deepEqual(viewports, [[700, 1_021]]);
});
