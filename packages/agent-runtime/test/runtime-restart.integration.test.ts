import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { RecurringWorkRecord, SessionRecord } from "../src/types.js";
import { LocalStore } from "../src/local-store.js";
import { TRANSIENT_RETRY_DELAY_MS } from "../src/retry-policy.js";

process.env.CHIEF_DATABASE_ENCRYPTION_KEY =
  "chief-runtime-integration-test-encryption-key";

function oneOffWork(scheduledFor: number): RecurringWorkRecord {
  return {
    id: "growth-report",
    conversationId: "schedule-conversation",
    agentId: "analyst",
    title: "Growth report",
    instructions: "Create the report.",
    cron: "0 9 * * 1",
    timezone: "UTC",
    onceAt: scheduledFor,
    status: "active",
    placement: "local",
    approvalSummary: "Read approved analytics data.",
    proposedToolPatterns: ["tools.analytics.read"],
    grant: {
      version: 1,
      approvedAt: scheduledFor - 1,
      toolPatterns: ["tools.analytics.read"],
    },
    nextAt: scheduledFor,
    createdAt: scheduledFor - 1,
    updatedAt: scheduledFor - 1,
  };
}

function runningSession(scheduledFor: number): SessionRecord {
  return {
    id: randomUUID(),
    parentId: "schedule-conversation",
    scheduleId: "growth-report",
    kind: "task",
    visibility: "private",
    agent: "chief",
    title: "Growth report",
    provider: "codex",
    status: "running",
    scheduledFor,
    startedAt: scheduledFor + 1,
    attempt: 1,
    createdAt: scheduledFor + 1,
    updatedAt: scheduledFor + 1,
  };
}

async function saveInitialWork(store: LocalStore, scheduledFor: number) {
  await store.createChat({
    id: "schedule-conversation",
    organizationId: "workspace",
    visibility: "user",
    agent: "chief",
    provider: "codex",
    title: "Growth report",
  });
  await store.saveRecurringWork("workspace", oneOffWork(scheduledFor));
}

void test("schedule claim and session creation are atomic across runtime processes", async () => {
  const directory = mkdtempSync(join(tmpdir(), "chief-runtime-"));
  const path = join(directory, "chief.sqlite");
  const first = new LocalStore(path);
  const scheduledFor = Date.now() - 1_000;

  try {
    await saveInitialWork(first, scheduledFor);
    const second = new LocalStore(path);
    try {
      const results = await Promise.all([
        first.startScheduleSession("workspace", runningSession(scheduledFor), {
          expectedNextAt: scheduledFor,
          nextAt: null,
        }),
        second.startScheduleSession("workspace", runningSession(scheduledFor), {
          expectedNextAt: scheduledFor,
          nextAt: null,
        }),
      ]);

      assert.deepEqual(results.sort(), [false, true]);
      assert.equal((await first.listScheduleSessions("workspace")).length, 1);
      assert.equal(
        (await first.recurringWorkById("workspace", "growth-report"))?.nextAt,
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

void test("runtime restart safely requeues an interrupted session that used no tools", async () => {
  const directory = mkdtempSync(join(tmpdir(), "chief-restart-"));
  const path = join(directory, "chief.sqlite");
  const scheduledFor = Date.now() - 1_000;
  let store = new LocalStore(path);

  try {
    await saveInitialWork(store, scheduledFor);
    assert.equal(
      await store.startScheduleSession(
        "workspace",
        runningSession(scheduledFor),
        {
          expectedNextAt: scheduledFor,
          nextAt: null,
        },
      ),
      true,
    );
    await store.close();

    store = new LocalStore(path);
    const recoveredAt = Date.now();
    assert.deepEqual(
      await store.reconcileInterruptedScheduleSessions(recoveredAt),
      {
        interrupted: 1,
        requeued: 1,
      },
    );
    const work = await store.recurringWorkById("workspace", "growth-report");
    assert.ok(work);
    assert.equal(work.status, "active");
    assert.ok(work.nextAt !== undefined);
    assert.ok(work.nextAt >= recoveredAt + TRANSIENT_RETRY_DELAY_MS);
    assert.match(work.lastSummary ?? "", /continue automatically/);
    assert.deepEqual(
      (await store.listScheduleSessions("workspace")).map(
        (session) => session.status,
      ),
      ["waiting"],
    );
    assert.deepEqual(await store.listActionItems("workspace"), []);
  } finally {
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

void test("pause wins a race with a stale schedule claim", async () => {
  const directory = mkdtempSync(join(tmpdir(), "chief-pause-"));
  const store = new LocalStore(join(directory, "chief.sqlite"));
  const scheduledFor = Date.now() - 1_000;
  const work = oneOffWork(scheduledFor);
  try {
    await saveInitialWork(store, scheduledFor);
    await store.saveRecurringWork("workspace", {
      ...work,
      status: "paused",
      nextAt: undefined,
      updatedAt: Date.now(),
    });

    assert.equal(
      await store.startScheduleSession(
        "workspace",
        runningSession(scheduledFor),
        {
          expectedNextAt: scheduledFor,
          nextAt: null,
        },
      ),
      false,
    );
    assert.deepEqual(await store.listScheduleSessions("workspace"), []);
  } finally {
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

void test("terminal session and schedule state commit atomically", async () => {
  const directory = mkdtempSync(join(tmpdir(), "chief-finish-"));
  const store = new LocalStore(join(directory, "chief.sqlite"));
  const scheduledFor = Date.now() - 1_000;
  const work = oneOffWork(scheduledFor);
  const session = runningSession(scheduledFor);
  try {
    await saveInitialWork(store, scheduledFor);
    await store.startScheduleSession("workspace", session, {
      expectedNextAt: scheduledFor,
      nextAt: null,
    });
    await assert.rejects(
      store.finishScheduleSession(
        "wrong-workspace",
        { ...session, status: "completed", finishedAt: Date.now() },
        { ...work, status: "paused" },
      ),
      /active schedule session was not found/,
    );
    assert.equal(
      (await store.listScheduleSessions("workspace"))[0]?.status,
      "running",
    );

    const finishedAt = Date.now();
    await store.raiseActionItem("workspace", {
      id: `action-${work.id}-blocked`,
      agentId: "chief",
      title: "Old block",
      reason: "Old blocked action that should be dismissed.",
      sourceId: session.id,
      status: "open",
      createdAt: finishedAt - 1,
    });
    await store.finishScheduleSession(
      "workspace",
      {
        ...session,
        status: "completed",
        finishedAt,
        summary: "Report complete.",
        updatedAt: finishedAt,
      },
      {
        ...work,
        status: "paused",
        nextAt: undefined,
        lastCompletedAt: finishedAt,
        lastSummary: "Report complete.",
        updatedAt: finishedAt,
      },
      {
        upsert: {
          id: `action-${work.id}-complete-review`,
          agentId: "chief",
          title: "Review completed report",
          reason: "The completed report needs a final user decision.",
          sourceId: session.id,
          status: "open",
          createdAt: finishedAt,
        },
        dismissIds: [`action-${work.id}-blocked`],
      },
    );
    assert.equal(
      (await store.listScheduleSessions("workspace"))[0]?.status,
      "completed",
    );
    const savedWork = await store.recurringWorkById("workspace", work.id);
    assert.ok(savedWork);
    assert.equal(savedWork.status, "paused");
    assert.equal(savedWork.lastCompletedAt, finishedAt);
    assert.equal(savedWork.lastSummary, "Report complete.");
    assert.deepEqual(
      (await store.listActionItems("workspace")).map((item) => item.id),
      [`action-${work.id}-complete-review`],
    );
  } finally {
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

void test("restart never replays an interrupted session that used tools", async () => {
  const directory = mkdtempSync(join(tmpdir(), "chief-tool-restart-"));
  const store = new LocalStore(join(directory, "chief.sqlite"));
  const scheduledFor = Date.now() - 1_000;
  const session = runningSession(scheduledFor);
  try {
    await saveInitialWork(store, scheduledFor);
    await store.startScheduleSession("workspace", session, {
      expectedNextAt: scheduledFor,
      nextAt: null,
    });
    await store.saveTranscript(
      {
        id: session.id,
        organizationId: "workspace",
        agentId: "chief",
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
      await store.reconcileInterruptedScheduleSessions(Date.now()),
      { interrupted: 1, requeued: 0 },
    );
    const work = await store.recurringWorkById("workspace", "growth-report");
    assert.ok(work);
    assert.equal(work.status, "needs_approval");
    assert.match(work.lastSummary ?? "", /will not retry automatically/);
    assert.deepEqual(await store.listActionItems("workspace"), [
      {
        id: "action-growth-report-interrupted",
        agentId: "chief",
        title: "Review interrupted work",
        reason:
          "Chief restarted after this session used tools. It will not retry automatically.",
        sourceId: session.id,
        status: "open",
        createdAt: (await store.listActionItems("workspace"))[0]?.createdAt,
      },
    ]);
    assert.equal(
      (await store.listScheduleSessions("workspace"))[0]?.status,
      "needs_approval",
    );
  } finally {
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

void test("a retry resumes the same occurrence and increments its attempt", async () => {
  const directory = mkdtempSync(join(tmpdir(), "chief-same-occurrence-"));
  const store = new LocalStore(join(directory, "chief.sqlite"));
  const scheduledFor = Date.now() - 1_000;
  const session = runningSession(scheduledFor);
  const retryAt = Date.now() + 30_000;
  try {
    await saveInitialWork(store, scheduledFor);
    await store.startScheduleSession("workspace", session, {
      expectedNextAt: scheduledFor,
      nextAt: null,
    });
    await store.updateChatState("workspace", session.id, {
      providerState: { sessionId: "provider-continuation" },
    });
    await store.waitingScheduleSession(
      "workspace",
      {
        ...session,
        status: "waiting",
        summary: "Chief will continue automatically.",
        updatedAt: Date.now(),
      },
      {
        ...oneOffWork(scheduledFor),
        nextAt: retryAt,
        lastSummary: "Chief will continue automatically.",
        updatedAt: Date.now(),
      },
    );
    assert.equal((await store.listScheduleSessions("workspace")).length, 1);
    assert.equal(
      (await store.listScheduleSessions("workspace"))[0]?.status,
      "waiting",
    );
    assert.deepEqual(await store.listActionItems("workspace"), []);

    const resumed = await store.resumeScheduleSession(
      "workspace",
      "growth-report",
      { expectedNextAt: retryAt, nextAt: null, startedAt: retryAt },
    );
    assert.ok(resumed);
    assert.equal(resumed.id, session.id);
    assert.equal(resumed.scheduledFor, scheduledFor);
    assert.equal(resumed.attempt, 2);
    assert.equal(resumed.status, "running");
    assert.deepEqual(
      (await store.chatRecord("workspace", session.id))?.providerState,
      { sessionId: "provider-continuation" },
    );
    assert.equal((await store.listScheduleSessions("workspace")).length, 1);
  } finally {
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

void test("finishing stale work preserves a concurrent timing edit", async () => {
  const directory = mkdtempSync(join(tmpdir(), "chief-timing-race-"));
  const store = new LocalStore(join(directory, "chief.sqlite"));
  const scheduledFor = Date.now() - 1_000;
  const work = oneOffWork(scheduledFor);
  const session = runningSession(scheduledFor);
  try {
    await saveInitialWork(store, scheduledFor);
    await store.startScheduleSession("workspace", session, {
      expectedNextAt: scheduledFor,
      nextAt: null,
    });
    const editedNextAt = Date.now() + 86_400_000;
    await store.saveRecurringWork("workspace", {
      ...work,
      cron: "30 10 * * 2",
      timezone: "Europe/London",
      onceAt: editedNextAt,
      nextAt: editedNextAt,
      updatedAt: Date.now(),
    });
    const finishedAt = Date.now();
    await store.finishScheduleSession(
      "workspace",
      { ...session, status: "completed", finishedAt, updatedAt: finishedAt },
      { ...work, status: "paused", nextAt: undefined, updatedAt: finishedAt },
    );

    const saved = await store.recurringWorkById("workspace", work.id);
    assert.ok(saved);
    assert.equal(saved.cron, "30 10 * * 2");
    assert.equal(saved.timezone, "Europe/London");
    assert.equal(saved.onceAt, editedNextAt);
    assert.equal(saved.nextAt, editedNextAt);
  } finally {
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
