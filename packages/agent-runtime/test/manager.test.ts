/* eslint-disable max-lines */

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
import { handleLocalTool, localToolsOpenApi } from "../src/local-tools.js";
import { resolveActiveAgentSession, SessionManager } from "../src/manager.js";
import { scheduledAgentConfig } from "../src/scheduled-agent-config.js";
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

void test("a workspace gateway cannot select another concurrent agent session", () => {
  const busy = [
    { chatId: "engineer-chat", agentId: "engineer" },
    { chatId: "research-chat", agentId: "researcher" },
  ];
  assert.equal(
    resolveActiveAgentSession(busy, "research-chat", false),
    undefined,
  );
  assert.deepEqual(resolveActiveAgentSession(busy, "research-chat", true), {
    chatId: "research-chat",
    agentId: "researcher",
  });
});

void test("browser run history survives restart as resumable state", async () => {
  const directory = mkdtempSync(join(tmpdir(), "chief-browser-history-"));
  const store = new LocalStore(join(directory, "chief.sqlite"));
  const manager = new SessionManager(store);
  try {
    await manager.createRootChat(
      "workspace-a",
      "conversation-a",
      "Browser chat",
      "codex",
    );
    await store.saveBrowserRun({
      id: "browser-run-a",
      workspaceId: "workspace-a",
      conversationId: "conversation-a",
      threadRootId: "thread-root",
      url: "https://www.apple.com/au/shop/buy-mac/macbook-pro",
      title: "Buy MacBook Pro - Apple (AU)",
      status: "active",
      createdAt: 1,
      updatedAt: 1,
    });
    await store.updateBrowserRun("workspace-a", "browser-run-a", {
      anchorMessageId: "message-a",
    });
    const resumed = await store.browserRun("workspace-a", "browser-run-a");
    assert.ok(resumed);
    assert.equal(resumed.conversationId, "conversation-a");
    assert.equal(resumed.anchorMessageId, "message-a");
    assert.equal(
      await store.browserRun("workspace-b", "browser-run-a"),
      undefined,
    );
    const [run] = await store.listBrowserRuns("workspace-a");
    assert.ok(run);
    assert.equal(run.status, "active");
    assert.equal(run.anchorMessageId, "message-a");
    assert.equal(run.threadRootId, "thread-root");
    assert.equal(run.title, "Buy MacBook Pro - Apple (AU)");
  } finally {
    await manager.stopAll();
    rmSync(directory, { recursive: true, force: true });
  }
});

function recurringWork(
  conversationId: string | undefined = "root",
): RecurringWorkRecord {
  return {
    id: "report",
    conversationId,
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

void test("concurrent setup opens create one durable root chat", async () => {
  const directory = mkdtempSync(join(tmpdir(), "chief-manager-root-race-"));
  const store = new LocalStore(join(directory, "chief.sqlite"));
  const manager = new SessionManager(store);
  try {
    const opened = await Promise.all(
      Array.from({ length: 4 }, () =>
        manager.createRootChat(
          "workspace-a",
          "integration-setup-v5-analytics.googleapis.com",
          "Google Analytics setup",
          "codex",
          undefined,
          "setup",
        ),
      ),
    );

    assert.ok(opened.every((chat) => chat?.agent === "setup"));
    assert.equal(
      (await store.listChats("workspace-a")).filter(
        (chat) => chat.id === "integration-setup-v5-analytics.googleapis.com",
      ).length,
      1,
    );
  } finally {
    await manager.stopAll();
    rmSync(directory, { recursive: true, force: true });
  }
});

void test("private tasks cannot compose as roots or appear as conversation children", async () => {
  const directory = mkdtempSync(join(tmpdir(), "chief-manager-"));
  const store = new LocalStore(join(directory, "chief.sqlite"));
  const manager = new SessionManager(store);
  try {
    await manager.createRootChat("workspace-a", "root", "Workspace", "codex");
    await manager.createRootChat(
      "workspace-a",
      "setup-root",
      "Google Analytics setup",
      "codex",
      undefined,
      "setup",
    );
    await store.createChat({
      id: "child",
      organizationId: "workspace-a",
      parentId: "root",
      kind: "task",
      visibility: "private",
      agent: "analyst",
      provider: "codex",
    });
    await manager.saveRecurringWork("workspace-a", recurringWork());
    assert.equal(
      await manager.startScheduleSession("workspace-a", scheduleSession(), {
        expectedNextAt: 2,
        nextAt: null,
      }),
      true,
    );

    assert.equal(
      (await manager.rootChat("workspace-a", "root")).chat.kind,
      "conversation",
    );
    assert.equal(
      (await manager.rootChat("workspace-a", "setup-root")).chat.agent,
      "setup",
    );
    for (const id of ["child", "schedule-session"]) {
      await assert.rejects(
        manager.rootChat("workspace-a", id),
        /top-level user-visible Chief chat/,
      );
    }
    assert.deepEqual(
      (await manager.childChats("workspace-a", "root")).map((chat) => chat.id),
      ["child"],
    );
    await assert.rejects(
      manager.inspectChat("workspace-b", "schedule-session"),
      /not found in this workspace/,
    );

    await manager.saveDraft("workspace-a", {
      id: "draft",
      agentId: "content",
      title: "Draft",
      body: "Greenfield content",
      platform: "blog",
      status: "draft",
      createdAt: 1,
      updatedAt: 1,
    });
    await manager.raiseActionItem("workspace-a", {
      id: "review-report",
      agentId: "chief",
      title: "Review report",
      reason: "The report needs approval.",
      sourceId: "schedule-session",
      status: "open",
      createdAt: 3,
    });
    const catchUpAt = Date.now() - 5_000;
    await manager.saveRecurringWork("workspace-a", {
      ...recurringWork(),
      id: "catch-up-report",
      onceAt: undefined,
      nextAt: catchUpAt,
    });
    const data = await manager.workspaceData("workspace-a");
    assert.equal(data.drafts[0]?.fileId, undefined);
    assert.deepEqual(
      data.activity.map((session) => session.id),
      ["child", "schedule-session"],
    );
    assert.deepEqual(
      data.actionItems.map((item) => item.id),
      ["review-report"],
    );
    assert.deepEqual(
      data.recurringWork.find((work) => work.id === "report")?.upcomingRuns,
      [],
    );
    const catchUpRuns = data.recurringWork.find(
      (work) => work.id === "catch-up-report",
    )?.upcomingRuns;
    assert.ok(catchUpRuns);
    assert.equal(catchUpRuns[0], catchUpAt);
    assert.equal(new Set(catchUpRuns).size, catchUpRuns.length);
    assert.ok(!("attentionItems" in data));
    assert.ok(!("recurringWorkRuns" in data));

    await manager.deleteRecurringWork("workspace-a", "report");
    assert.ok(await store.chatRecord("workspace-a", "root"));
    assert.equal(
      await store.chatRecord("workspace-a", "schedule-session"),
      null,
    );
  } finally {
    await manager.stopAll();
    rmSync(directory, { recursive: true, force: true });
  }
});

void test("Google Analytics setup tools preserve the agent-driven OAuth handoff", async () => {
  const directory = mkdtempSync(join(tmpdir(), "chief-manager-analytics-"));
  const store = new LocalStore(join(directory, "chief.sqlite"));
  const manager = new SessionManager(store);
  const calls: string[] = [];
  const context = {
    integrationSetup: {
      googleAnalytics: {
        startAuthorization: (sessionId: string, attemptId: string) => {
          calls.push(`authorize:${sessionId}:${attemptId}`);
          return Promise.resolve({
            authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
            state: "state-1",
          });
        },
        completeAuthorization: (
          sessionId: string,
          attemptId: string,
          state?: string,
        ) => {
          calls.push(
            `complete:${sessionId}:${attemptId}:${state ?? "existing"}`,
          );
          return Promise.resolve({ status: "connected" });
        },
        selectProperty: (
          sessionId: string,
          attemptId: string,
          propertyId: string,
        ) => {
          calls.push(`select:${sessionId}:${attemptId}:${propertyId}`);
          return Promise.resolve({ status: "connected", propertyId });
        },
      },
    },
  };
  const invoke = (path: string, body: Record<string, unknown> = {}) =>
    handleLocalTool(
      new Request(`http://localhost${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      "workspace",
      manager,
      context,
    );
  try {
    assert.equal(
      (
        await invoke("/local-tools/integrations/google-analytics/authorize", {
          attemptId: "attempt-1",
          sessionId: "setup-session",
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await invoke("/local-tools/integrations/google-analytics/complete", {
          attemptId: "attempt-1",
          state: "state-1",
          sessionId: "setup-session",
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await invoke("/local-tools/integrations/google-analytics/select", {
          attemptId: "attempt-1",
          propertyId: "properties/123",
          sessionId: "setup-session",
        })
      ).status,
      200,
    );
    assert.deepEqual(calls, [
      "authorize:setup-session:attempt-1",
      "complete:setup-session:attempt-1:state-1",
      "select:setup-session:attempt-1:properties/123",
    ]);
    const spec = JSON.stringify(localToolsOpenApi("http://localhost"));
    assert.match(spec, /googleAnalytics\.authorize/);
    assert.match(spec, /googleAnalytics\.complete/);
    assert.match(spec, /googleAnalytics\.select/);
  } finally {
    await manager.stopAll();
    rmSync(directory, { recursive: true, force: true });
  }
});

void test("scheduled channel work resolves its assigned agent provider", async () => {
  const directory = mkdtempSync(join(tmpdir(), "chief-schedule-owner-"));
  const store = new LocalStore(join(directory, "chief.sqlite"));
  const manager = new SessionManager(store);
  try {
    await manager.saveAgentPreference("workspace", {
      agentId: "chief",
      enabled: true,
      driver: "codex",
      model: "root-model",
      approvals: "ask",
      toolPermissions: ["channels.read", "messages.send"],
    });
    await manager.saveAgentPreference("workspace", {
      agentId: "analyst",
      enabled: true,
      driver: "claude",
      model: "specialist-model",
    });
    const config = await scheduledAgentConfig(manager, "workspace", {
      ...recurringWork(),
      agentId: "analyst",
      conversationId: undefined,
    });

    assert.ok(config);
    assert.equal(config.agent.id, "analyst");
    assert.equal(config.preference.driver, "claude");
    assert.equal(config.preference.model, "specialist-model");
  } finally {
    await manager.stopAll();
    rmSync(directory, { recursive: true, force: true });
  }
});

void test("schedule task ownership is isolated from its conversation", async () => {
  const directory = mkdtempSync(join(tmpdir(), "chief-execution-owner-"));
  const store = new LocalStore(join(directory, "chief.sqlite"));
  const manager = new SessionManager(store);
  try {
    await manager.createRootChat("workspace", "root", "Workspace", "codex");
    await manager.saveRecurringWork("workspace", recurringWork());
    await manager.startScheduleSession("workspace", scheduleSession(), {
      expectedNextAt: 2,
      nextAt: null,
    });

    const releaseSchedule = manager.acquireExecution(
      "workspace",
      "schedule-session",
      "schedule",
    );
    await manager.assertInteractiveChat("workspace", "root");
    const releaseInteractive = manager.acquireExecution(
      "workspace",
      "root",
      "interactive",
    );
    await assert.rejects(
      manager.assertInteractiveChat("workspace", "schedule-session"),
      /owned by schedule work/,
    );
    assert.throws(
      () =>
        manager.acquireExecution(
          "workspace",
          "schedule-session",
          "interactive",
        ),
      /already running schedule work/,
    );

    releaseInteractive();
    releaseSchedule();
  } finally {
    await manager.stopAll();
    rmSync(directory, { recursive: true, force: true });
  }
});

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
    const work = {
      ...recurringWork(),
      conversationId: undefined,
    };
    await manager.saveRecurringWork("workspace", work);
    await manager.startScheduleSession(
      "workspace",
      { ...scheduleSession(), parentId: undefined },
      {
        expectedNextAt: 2,
        nextAt: null,
      },
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
