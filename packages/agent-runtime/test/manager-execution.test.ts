import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type {
  AgentDefinition,
  AgentEvent,
  RecurringWorkRecord,
  SessionRecord,
} from "../src/types.js";
import { LocalStore } from "../src/local-store.js";
import { SessionManager } from "../src/manager.js";
import { AgentSession } from "../src/session.js";

process.env.CHIEF_DATABASE_ENCRYPTION_KEY =
  "chief-runtime-integration-test-encryption-key";

const cmo: AgentDefinition = {
  id: "chief",
  name: "Chief",
  role: "Chief marketing officer",
  description: "Runs marketing work.",
  instructions: "Run the requested work.",
};

function recurringWork(): RecurringWorkRecord {
  return {
    id: "report",
    agentId: "analyst",
    title: "Report",
    instructions: "Review the data.",
    cron: "0 9 * * 1",
    timezone: "UTC",
    onceAt: 2,
    status: "active",
    placement: "local",
    approvalSummary: "Read approved data.",
    proposedToolPatterns: [],
    grant: { version: 1, approvedAt: 1, toolPatterns: [] },
    nextAt: 2,
    createdAt: 1,
    updatedAt: 1,
  };
}

function scheduleSession(parentId: string | undefined = "root"): SessionRecord {
  return {
    id: "schedule-session",
    parentId,
    scheduleId: "report",
    kind: "task",
    visibility: "private",
    agent: "chief",
    title: "Report occurrence",
    provider: "codex",
    status: "running",
    scheduledFor: 2,
    startedAt: 3,
    attempt: 1,
    createdAt: 3,
    updatedAt: 3,
  };
}

void test("queued execution claims are granted one at a time", async () => {
  const directory = mkdtempSync(join(tmpdir(), "chief-execution-queue-"));
  const store = new LocalStore(join(directory, "chief.sqlite"));
  const manager = new SessionManager(store);
  try {
    const releaseFirst = manager.acquireExecution(
      "workspace",
      "chat",
      "interactive",
    );
    const second = manager.acquireExecutionWhenAvailable(
      "workspace",
      "chat",
      "interactive",
      1_000,
    );
    const third = manager.acquireExecutionWhenAvailable(
      "workspace",
      "chat",
      "interactive",
      1_000,
    );
    const claimed: string[] = [];
    const secondReady = second.then((release) => {
      claimed.push("second");
      return { name: "second", release };
    });
    const thirdReady = third.then((release) => {
      claimed.push("third");
      return { name: "third", release };
    });
    releaseFirst();
    const firstQueued = await Promise.race([secondReady, thirdReady]);
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(claimed.length, 1);
    firstQueued.release();
    const finalQueued = await (firstQueued.name === "second"
      ? thirdReady
      : secondReady);
    finalQueued.release();
  } finally {
    await manager.stopAll();
    rmSync(directory, { recursive: true, force: true });
  }
});

void test("chat-adjacent writes are serialized with transcript persistence", async () => {
  const directory = mkdtempSync(join(tmpdir(), "chief-chat-write-queue-"));
  const store = new LocalStore(join(directory, "chief.sqlite"));
  const manager = new SessionManager(store);
  const order: string[] = [];
  let releaseFirst!: () => void;
  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  try {
    const first = manager.enqueueChatPersistence(
      "workspace",
      "channel:general",
      async () => {
        order.push("first:start");
        await firstGate;
        order.push("first:end");
      },
    );
    const second = manager.enqueueChatPersistence(
      "workspace",
      "channel:general",
      () => {
        order.push("second");
        return Promise.resolve();
      },
    );
    await Promise.resolve();
    assert.deepEqual(order, ["first:start"]);
    releaseFirst();
    await Promise.all([first, second]);
    assert.deepEqual(order, ["first:start", "first:end", "second"]);
    await assert.rejects(
      manager.enqueueChatPersistence("workspace", "channel:general", () =>
        Promise.reject(new Error("expected write failure")),
      ),
      /expected write failure/,
    );
    await manager.enqueueChatPersistence("workspace", "channel:general", () => {
      order.push("after failure");
      return Promise.resolve();
    });
    assert.equal(order.at(-1), "after failure");
  } finally {
    await manager.stopAll();
    rmSync(directory, { recursive: true, force: true });
  }
});

void test("task sessions preserve schedule metadata and persist every diagnostic event", async () => {
  const directory = mkdtempSync(join(tmpdir(), "chief-manager-diagnostics-"));
  const store = new LocalStore(join(directory, "chief.sqlite"));
  const manager = new SessionManager(store);
  const originalStart = Object.getOwnPropertyDescriptor(
    AgentSession.prototype,
    "start",
  );
  let resumedProviderSession: string | undefined;
  Object.defineProperty(AgentSession.prototype, "start", {
    configurable: true,
    async value(this: AgentSession, _cwd: string, resumeSessionId?: string) {
      resumedProviderSession = resumeSessionId;
      await Promise.resolve(this);
    },
  });
  try {
    const work = recurringWork();
    await manager.saveRecurringWork("workspace", work);
    await manager.startScheduleSession(
      "workspace",
      { ...scheduleSession(), parentId: undefined },
      { expectedNextAt: 2, nextAt: null },
    );
    await store.updateChatState("workspace", "schedule-session", {
      providerState: { sessionId: "provider-continuation" },
    });
    const retryAt = Date.now() + 30_000;
    await manager.waitingScheduleSession(
      "workspace",
      {
        ...scheduleSession(),
        parentId: undefined,
        status: "waiting",
        updatedAt: Date.now(),
      },
      { ...work, nextAt: retryAt, updatedAt: Date.now() },
    );
    const resumed = await manager.resumeScheduleSession("workspace", work.id, {
      expectedNextAt: retryAt,
      nextAt: null,
      startedAt: retryAt,
    });
    assert.equal(resumed?.attempt, 2);
    const session = await manager.ensureTaskSession(
      cmo,
      undefined,
      "schedule-session",
      {
        driver: "codex",
        access: "guarded",
        workspaceId: "workspace",
        executionOwner: "schedule",
        automationGrant: { version: 1, approvedAt: 1, toolPatterns: [] },
      },
    );
    assert.equal(resumedProviderSession, "provider-continuation");
    assert.match(
      session.agent.instructions,
      /current Chief session ID is schedule-session/,
    );
    const events: AgentEvent[] = [
      { type: "stream", text: "Working" },
      { type: "toolProgress", toolUseId: "tool-1", text: "Reading" },
      { type: "status", status: "running" },
      {
        type: "message",
        role: "user",
        content: [{ type: "text", text: "Run the report." }],
      },
      {
        type: "message",
        role: "assistant",
        content: [
          { type: "tool_use", id: "tool-1", name: "analytics.read", input: {} },
        ],
      },
      { type: "exit", code: 0 },
    ];
    for (const event of events) {
      session.events.push(event);
      session.emit("event", event);
    }
    await manager.waitForChatPersistence("workspace", "schedule-session");
    const stored = await store.chatRecord("workspace", "schedule-session");
    assert.ok(stored);
    assert.equal(stored.parentId, undefined);
    assert.equal(stored.scheduleId, "report");
    assert.equal(stored.kind, "task");
    assert.equal(stored.visibility, "private");
    assert.equal(stored.status, "running");
    assert.equal(stored.attempt, 2);
    assert.equal(stored.title, "Report occurrence");
    const diagnostics = await manager.diagnostics("workspace");
    assert.deepEqual(
      diagnostics.events.map((event) => [event.position, event.type]),
      events.map((event, position) => [position, event.type]),
    );
  } finally {
    if (originalStart) {
      Object.defineProperty(AgentSession.prototype, "start", originalStart);
    }
    await manager.stopAll();
    rmSync(directory, { recursive: true, force: true });
  }
});

void test("concurrent opens share one provider startup", async () => {
  const directory = mkdtempSync(join(tmpdir(), "chief-manager-startup-"));
  const store = new LocalStore(join(directory, "chief.sqlite"));
  const manager = new SessionManager(store);
  const originalStart = Object.getOwnPropertyDescriptor(
    AgentSession.prototype,
    "start",
  );
  let startCount = 0;
  let releaseStart: (() => void) | undefined;
  const startGate = new Promise<void>((resolve) => {
    releaseStart = resolve;
  });
  Object.defineProperty(AgentSession.prototype, "start", {
    configurable: true,
    async value() {
      startCount += 1;
      await startGate;
    },
  });
  try {
    await manager.createRootChat("workspace", "root", "Review", "codex");
    const config = {
      driver: "codex" as const,
      access: "guarded" as const,
      workspaceId: "workspace",
      executionOwner: "interactive" as const,
    };
    const first = manager.ensureRootChat(cmo, "root", config);
    const second = manager.ensureRootChat(cmo, "root", config);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(startCount, 1);
    releaseStart?.();
    const [firstSession, secondSession] = await Promise.all([first, second]);
    assert.equal(firstSession, secondSession);
    assert.equal(startCount, 1);
  } finally {
    releaseStart?.();
    if (originalStart) {
      Object.defineProperty(AgentSession.prototype, "start", originalStart);
    }
    await manager.stopAll();
    rmSync(directory, { recursive: true, force: true });
  }
});
