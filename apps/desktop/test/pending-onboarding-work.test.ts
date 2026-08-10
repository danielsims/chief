import assert from "node:assert/strict";
import test from "node:test";

import {
  clearPendingOnboardingWorkWhenPersisted,
  mergePendingOnboardingSchedules,
  pendingOnboardingWorkStorageKey,
} from "../src/lib/pending-onboarding-work.js";
import { emptyWorkspaceData } from "../src/lib/workspace-data.js";

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

void test("keeps onboarding schedules visible until the runtime persists them", () => {
  const previousWindow = globalThis.window;
  const localStorage = new MemoryStorage();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage },
  });

  try {
    const workspaceId = "workspace-1";
    const storageKey = pendingOnboardingWorkStorageKey(workspaceId);
    localStorage.setItem(
      storageKey,
      JSON.stringify({
        jobs: [],
        schedules: [
          {
            id: "daily-review",
            playbookId: "growth-brief",
            agentId: "analyst",
            title: "Daily review",
            instructions: "Review the latest signals.",
            cron: "0 9 * * *",
            timezone: "UTC",
            status: "active",
            approvalSummary: "Runs every day at 9:00 am.",
            proposedToolPatterns: ["tools.search"],
          },
        ],
      }),
    );

    const now = Date.UTC(2026, 7, 10, 8);
    const optimistic = mergePendingOnboardingSchedules(
      workspaceId,
      emptyWorkspaceData,
      now,
    );
    assert.equal(optimistic.recurringWork.length, 1);
    const queuedSchedule = optimistic.recurringWork[0];
    assert.ok(queuedSchedule);
    assert.equal(queuedSchedule.id, "daily-review");
    assert.equal(queuedSchedule.nextAt, Date.UTC(2026, 7, 10, 9));
    assert.equal(
      clearPendingOnboardingWorkWhenPersisted(workspaceId, []),
      false,
    );
    assert.equal(localStorage.getItem(storageKey) !== null, true);

    assert.equal(
      clearPendingOnboardingWorkWhenPersisted(
        workspaceId,
        optimistic.recurringWork,
      ),
      true,
    );
    assert.equal(localStorage.getItem(storageKey), null);
  } finally {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: previousWindow,
    });
  }
});
