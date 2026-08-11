import assert from "node:assert/strict";
import test from "node:test";

import type { SessionManager } from "../src/manager.js";
import {
  persistSpecialistOutcomeState,
  setupNeedsHumanSignIn,
} from "../src/specialist-outcome-state.js";

void test("Setup stays waiting while a browser handoff needs the user", async () => {
  const finished: unknown[] = [];
  const updates: unknown[] = [];
  const manager = {
    finishChildChat: (...args: unknown[]) => {
      finished.push(args);
    },
    waitForChatPersistence: () => Promise.resolve(),
    store: {
      listBrowserRuns: () => Promise.resolve([]),
      updateChatState: (...args: unknown[]) => {
        updates.push(args);
      },
    },
  } as unknown as SessionManager;

  await persistSpecialistOutcomeState({
    manager,
    workspaceId: "workspace",
    sessionId: "setup-session",
    agentId: "setup",
    outcome: {
      status: "completed",
      result: "The browser is ready. Please sign in, then I will continue.",
    },
  });

  assert.equal(finished.length, 0);
  assert.deepEqual(updates, [
    [
      "workspace",
      "setup-session",
      {
        status: "waiting",
        summary: "The browser is ready. Please sign in, then I will continue.",
      },
    ],
  ]);
});

void test("an active Setup browser is a waiting handoff even after a tool error", async () => {
  const finished: unknown[] = [];
  const updates: unknown[] = [];
  const manager = {
    finishChildChat: (...args: unknown[]) => {
      finished.push(args);
    },
    waitForChatPersistence: () => Promise.resolve(),
    store: {
      listBrowserRuns: () =>
        Promise.resolve([
          {
            id: "browser",
            workspaceId: "workspace",
            conversationId: "setup-session",
            url: "https://accounts.google.com",
            status: "active",
            createdAt: 1,
            updatedAt: 1,
          },
        ]),
      updateChatState: (...args: unknown[]) => {
        updates.push(args);
      },
    },
  } as unknown as SessionManager;

  await persistSpecialistOutcomeState({
    manager,
    workspaceId: "workspace",
    sessionId: "setup-session",
    agentId: "setup",
    outcome: {
      status: "failed",
      error: "Provider authorization paused before verification.",
    },
  });

  assert.equal(finished.length, 0);
  assert.deepEqual(updates, [
    [
      "workspace",
      "setup-session",
      {
        status: "waiting",
        summary: "Provider authorization paused before verification.",
      },
    ],
  ]);
});

void test("completed specialist work still reaches the terminal state", async () => {
  const finished: unknown[] = [];
  const manager = {
    finishChildChat: (...args: unknown[]) => {
      finished.push(args);
    },
  } as unknown as SessionManager;

  await persistSpecialistOutcomeState({
    manager,
    workspaceId: "workspace",
    sessionId: "brand-session",
    agentId: "brand",
    outcome: { status: "completed", result: "Profile saved." },
  });

  assert.deepEqual(finished, [
    [
      "workspace",
      "brand-session",
      { status: "completed", result: "Profile saved." },
    ],
  ]);
});

void test("ordinary setup completion is not mistaken for a sign-in handoff", () => {
  assert.equal(setupNeedsHumanSignIn("Google Analytics is connected."), false);
});
