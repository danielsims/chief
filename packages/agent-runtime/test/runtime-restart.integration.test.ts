import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type {
  RecurringWorkRecord,
  RecurringWorkRunRecord,
} from "../src/types.js";
import { LocalStore } from "../src/local-store.js";

process.env.CHIEF_DATABASE_ENCRYPTION_KEY =
  "chief-runtime-integration-test-encryption-key";

function oneOffWork(scheduledFor: number): RecurringWorkRecord {
  return {
    id: "growth-report",
    chatId: "schedule-chat",
    agentId: "analyst",
    title: "Growth report",
    instructions: "Create the report.",
    cron: "0 9 * * 1",
    timezone: "UTC",
    runOnceAt: scheduledFor,
    status: "active",
    placement: "local",
    approvalSummary: "Read approved analytics data.",
    proposedToolPatterns: ["tools.analytics.read"],
    grant: {
      version: 1,
      approvedAt: scheduledFor - 1,
      toolPatterns: ["tools.analytics.read"],
    },
    nextRunAt: scheduledFor,
    createdAt: scheduledFor - 1,
    updatedAt: scheduledFor - 1,
  };
}

function runningAttempt(scheduledFor: number): RecurringWorkRunRecord {
  return {
    id: randomUUID(),
    recurringWorkId: "growth-report",
    chatId: "schedule-chat",
    status: "running",
    scheduledFor,
    startedAt: scheduledFor + 1,
  };
}

async function saveInitialWork(store: LocalStore, scheduledFor: number) {
  await store.createChat({
    id: "schedule-chat",
    workspaceId: "workspace",
    visibility: "user",
    agent: "cmo",
    provider: "codex",
    title: "Growth report",
  });
  await store.saveRecurringWork("workspace", oneOffWork(scheduledFor));
}

void test("claim and attempt creation are atomic across runtime processes", async () => {
  const directory = mkdtempSync(join(tmpdir(), "chief-runtime-"));
  const path = join(directory, "chief.sqlite");
  const first = new LocalStore(path);
  const scheduledFor = Date.now() - 1_000;

  try {
    await saveInitialWork(first, scheduledFor);
    const second = new LocalStore(path);
    try {
      const results = await Promise.all([
        first.startRecurringWorkRun("workspace", runningAttempt(scheduledFor), {
          expectedNextRunAt: scheduledFor,
          nextRunAt: null,
        }),
        second.startRecurringWorkRun(
          "workspace",
          runningAttempt(scheduledFor),
          { expectedNextRunAt: scheduledFor, nextRunAt: null },
        ),
      ]);

      assert.deepEqual(results.sort(), [false, true]);
      assert.equal((await first.listRecurringWorkRuns("workspace")).length, 1);
      assert.equal(
        (await first.recurringWorkById("workspace", "growth-report"))
          ?.nextRunAt,
        undefined,
      );
    } finally {
      await second.close();
    }
  } finally {
    await first.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

void test("runtime restart closes an interrupted occurrence without replaying it", async () => {
  const directory = mkdtempSync(join(tmpdir(), "chief-restart-"));
  const path = join(directory, "chief.sqlite");
  const scheduledFor = Date.now() - 1_000;
  let store = new LocalStore(path);

  try {
    await saveInitialWork(store, scheduledFor);
    assert.equal(
      await store.startRecurringWorkRun(
        "workspace",
        runningAttempt(scheduledFor),
        { expectedNextRunAt: scheduledFor, nextRunAt: null },
      ),
      true,
    );
    await store.close();

    store = new LocalStore(path);
    assert.deepEqual(
      await store.reconcileInterruptedRecurringWorkRuns(Date.now()),
      { interrupted: 1, requeued: 0 },
    );
    const work = await store.recurringWorkById("workspace", "growth-report");
    assert.ok(work);
    assert.equal(work.status, "needs_approval");
    assert.equal(work.nextRunAt, undefined);
    assert.match(work.lastResult ?? "", /Review it before trying again/);
    assert.deepEqual(
      (await store.listRecurringWorkRuns("workspace")).map((run) => run.status),
      ["failed"],
    );
  } finally {
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

void test("pause wins a race with a stale scheduled claim", async () => {
  const directory = mkdtempSync(join(tmpdir(), "chief-pause-"));
  const store = new LocalStore(join(directory, "chief.sqlite"));
  const scheduledFor = Date.now() - 1_000;
  const work = oneOffWork(scheduledFor);
  try {
    await saveInitialWork(store, scheduledFor);
    await store.saveRecurringWork("workspace", {
      ...work,
      status: "paused",
      nextRunAt: undefined,
      updatedAt: Date.now(),
    });

    assert.equal(
      await store.startRecurringWorkRun(
        "workspace",
        runningAttempt(scheduledFor),
        { expectedNextRunAt: scheduledFor, nextRunAt: null },
      ),
      false,
    );
    assert.deepEqual(await store.listRecurringWorkRuns("workspace"), []);
  } finally {
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

void test("terminal run and work state commit atomically", async () => {
  const directory = mkdtempSync(join(tmpdir(), "chief-finish-"));
  const store = new LocalStore(join(directory, "chief.sqlite"));
  const scheduledFor = Date.now() - 1_000;
  const work = oneOffWork(scheduledFor);
  const run = runningAttempt(scheduledFor);
  try {
    await saveInitialWork(store, scheduledFor);
    await store.startRecurringWorkRun("workspace", run, {
      expectedNextRunAt: scheduledFor,
      nextRunAt: null,
    });
    await assert.rejects(
      store.finishRecurringWorkRun(
        "workspace",
        { ...run, status: "completed", finishedAt: Date.now() },
        { ...work, id: "missing-work", status: "paused" },
      ),
      /definition was not found/,
    );
    assert.equal(
      (await store.listRecurringWorkRuns("workspace"))[0]?.status,
      "running",
    );

    await store.finishRecurringWorkRun(
      "workspace",
      { ...run, status: "completed", finishedAt: Date.now() },
      { ...work, status: "paused", nextRunAt: undefined },
    );
    assert.equal(
      (await store.listRecurringWorkRuns("workspace"))[0]?.status,
      "completed",
    );
    assert.equal(
      (await store.recurringWorkById("workspace", work.id))?.status,
      "paused",
    );
  } finally {
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

void test("restart never replays an interrupted run that used tools", async () => {
  const directory = mkdtempSync(join(tmpdir(), "chief-tool-restart-"));
  const store = new LocalStore(join(directory, "chief.sqlite"));
  const scheduledFor = Date.now() - 1_000;
  const run = runningAttempt(scheduledFor);
  try {
    await saveInitialWork(store, scheduledFor);
    await store.startRecurringWorkRun("workspace", run, {
      expectedNextRunAt: scheduledFor,
      nextRunAt: null,
    });
    await store.saveTranscript(
      {
        id: run.chatId,
        workspaceId: "workspace",
        agentId: "cmo",
        driver: "codex",
      },
      [
        {
          type: "message",
          role: "user",
          content: [{ type: "text", text: "Run the report." }],
        },
        {
          type: "message",
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "tool-1",
              name: "content.save",
              input: {},
            },
          ],
        },
      ],
    );

    assert.deepEqual(
      await store.reconcileInterruptedRecurringWorkRuns(Date.now()),
      { interrupted: 1, requeued: 0 },
    );
    const work = await store.recurringWorkById("workspace", "growth-report");
    assert.ok(work);
    assert.equal(work.status, "needs_approval");
    assert.match(work.lastResult ?? "", /will not retry automatically/);
  } finally {
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
