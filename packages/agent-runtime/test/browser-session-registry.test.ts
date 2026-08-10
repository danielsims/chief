import assert from "node:assert/strict";
import test from "node:test";

import type { AgentBrowserSession } from "@chief/browser/node";

import {
  BrowserSessionRegistry,
  commandTargetsActiveBrowserRun,
  resumableBrowserRuns,
} from "../src/browser-session-registry.js";

void test("a stale browser control cannot target the replacement run", () => {
  assert.equal(commandTargetsActiveBrowserRun("fresh", "old"), false);
  assert.equal(commandTargetsActiveBrowserRun("fresh", "fresh"), true);
  assert.equal(commandTargetsActiveBrowserRun(undefined, "old"), false);
});

void test("keeps only the newest active browser run per conversation", () => {
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
    ["new", "other"],
  );
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
  } as unknown as AgentBrowserSession;
  const registry = new BrowserSessionRegistry(() => session);
  registry.session("workspace", "conversation");
  await registry.reset("workspace", "conversation");
  assert.deepEqual(calls, ["close", "clear"]);
});

void test("deduplicates an already applied browser viewport", async () => {
  const viewports: [number, number][] = [];
  const session = {
    setViewport: (width: number, height: number) => {
      viewports.push([width, height]);
      return Promise.resolve();
    },
  } as AgentBrowserSession;
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
