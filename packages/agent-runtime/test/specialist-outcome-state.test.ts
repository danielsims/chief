import assert from "node:assert/strict";
import test from "node:test";

import type { SpecialistOutcomeManager } from "../src/specialist-outcome-state.js";
import {
  persistSpecialistOutcomeState,
  setupNeedsHumanSignIn,
} from "../src/specialist-outcome-state.js";

type SpecialistOutcomeManagerOverrides = Partial<
  Omit<SpecialistOutcomeManager, "store">
> & {
  store?: Partial<SpecialistOutcomeManager["store"]>;
};

function specialistManager(
  overrides: SpecialistOutcomeManagerOverrides,
): SpecialistOutcomeManager {
  const base: SpecialistOutcomeManager = {
    finishChildChat: () => undefined,
    waitForChatPersistence: () => Promise.resolve(),
    raiseActionItem: () => undefined,
    dismissActionItem: () => undefined,
    store: {
      listBrowserRuns: () => Promise.resolve([]),
      listActionItems: () => Promise.resolve([]),
      chatRecord: () => Promise.resolve(null),
      updateChatState: () => undefined,
    },
  };
  return {
    ...base,
    ...overrides,
    store: { ...base.store, ...overrides.store },
  };
}

void test("Setup stays waiting while a browser handoff needs the user", async () => {
  const finished: unknown[] = [];
  const updates: unknown[] = [];
  const actions: unknown[] = [];
  const manager = specialistManager({
    finishChildChat: (...args: unknown[]) => {
      finished.push(args);
    },
    waitForChatPersistence: () => Promise.resolve(),
    raiseActionItem: (...args: unknown[]) => {
      actions.push(args);
    },
    store: {
      listBrowserRuns: () => Promise.resolve([]),
      listActionItems: () => Promise.resolve([]),
      chatRecord: () => Promise.resolve({ title: "Connect Google Analytics" }),
      updateChatState: (...args: unknown[]) => {
        updates.push(args);
      },
    },
  });

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
  assert.equal(actions.length, 1);
  const [actionWorkspace, action] = actions[0] as [
    string,
    {
      id: string;
      agentId: string;
      title: string;
      reason: string;
      sourceId: string;
      status: string;
      createdAt: number;
    },
  ];
  assert.equal(actionWorkspace, "workspace");
  assert.match(action.id, /^action-[a-f0-9]{32}$/);
  assert.deepEqual(
    {
      ...action,
      createdAt: 0,
    },
    {
      id: action.id,
      agentId: "setup",
      title: "Connect Google Analytics",
      reason:
        "Continue the sign-in or consent step in Setup to finish “Connect Google Analytics”.",
      sourceId: "setup-session",
      status: "open",
      createdAt: 0,
    },
  );
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
  const actions: unknown[] = [];
  const manager = specialistManager({
    finishChildChat: (...args: unknown[]) => {
      finished.push(args);
    },
    waitForChatPersistence: () => Promise.resolve(),
    raiseActionItem: (...args: unknown[]) => {
      actions.push(args);
    },
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
      listActionItems: () =>
        Promise.resolve([
          {
            id: "existing-action",
            agentId: "setup",
            sourceId: "setup-session",
            status: "open",
          },
        ]),
      updateChatState: (...args: unknown[]) => {
        updates.push(args);
      },
    },
  });

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
  assert.equal(actions.length, 0);
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
  const manager = specialistManager({
    finishChildChat: (...args: unknown[]) => {
      finished.push(args);
    },
  });

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

void test("completed Setup work clears its session-scoped attention", async () => {
  const finished: unknown[] = [];
  const dismissed: unknown[] = [];
  const manager = specialistManager({
    finishChildChat: (...args: unknown[]) => {
      finished.push(args);
    },
    dismissActionItem: (...args: unknown[]) => {
      dismissed.push(args);
    },
    store: {
      listBrowserRuns: () => Promise.resolve([]),
      listActionItems: () =>
        Promise.resolve([
          {
            id: "setup-action",
            agentId: "setup",
            sourceId: "setup-session",
            status: "open",
          },
          {
            id: "another-action",
            agentId: "chief",
            sourceId: "setup-session",
            status: "open",
          },
        ]),
    },
  });

  await persistSpecialistOutcomeState({
    manager,
    workspaceId: "workspace",
    sessionId: "setup-session",
    agentId: "setup",
    outcome: { status: "completed", result: "Google Analytics is connected." },
  });

  assert.deepEqual(dismissed, [["workspace", "setup-action"]]);
  assert.deepEqual(finished, [
    [
      "workspace",
      "setup-session",
      { status: "completed", result: "Google Analytics is connected." },
    ],
  ]);
});

void test("ordinary setup completion is not mistaken for a sign-in handoff", () => {
  assert.equal(setupNeedsHumanSignIn("Google Analytics is connected."), false);
});
