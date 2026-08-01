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
import { SessionManager } from "../src/manager.js";
import { scheduledAgentConfig } from "../src/scheduled-agent-config.js";
import { AgentSession } from "../src/session.js";

process.env.CHIEF_DATABASE_ENCRYPTION_KEY =
  "chief-runtime-integration-test-encryption-key";

const cmo: AgentDefinition = {
  id: "cmo",
  name: "CMO",
  role: "Chief marketing officer",
  description: "Runs marketing work.",
  instructions: "Run the requested work.",
};

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
    agent: "cmo",
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
      agentId: "cmo",
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
        calls.push(`complete:${sessionId}:${attemptId}:${state ?? "existing"}`);
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

void test("schedule execution always resolves the CMO provider", async () => {
  const directory = mkdtempSync(join(tmpdir(), "chief-schedule-owner-"));
  const store = new LocalStore(join(directory, "chief.sqlite"));
  const manager = new SessionManager(store);
  try {
    await manager.saveAgentPreference("workspace", {
      agentId: "cmo",
      enabled: true,
      driver: "codex",
      model: "root-model",
      approvals: "ask",
    });
    await manager.saveAgentPreference("workspace", {
      agentId: "analyst",
      enabled: true,
      driver: "claude",
      model: "specialist-model",
    });
    const config = await scheduledAgentConfig(manager, "workspace", {
      ...recurringWork(),
      conversationId: undefined,
    });

    assert.ok(config);
    assert.equal(config.agent.id, "cmo");
    assert.equal(config.preference.driver, "codex");
    assert.equal(config.preference.model, "root-model");
    assert.equal(config.preference.approvals, "ask");
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

void test("switching root execution replaces the idle session and clears continuation state", async () => {
  const directory = mkdtempSync(join(tmpdir(), "chief-manager-switch-"));
  const store = new LocalStore(join(directory, "chief.sqlite"));
  const manager = new SessionManager(store);
  const originalStart = Object.getOwnPropertyDescriptor(
    AgentSession.prototype,
    "start",
  );
  const originalStop = Object.getOwnPropertyDescriptor(
    AgentSession.prototype,
    "stop",
  );
  let startCount = 0;
  Object.defineProperty(AgentSession.prototype, "start", {
    configurable: true,
    async value() {
      startCount += 1;
      await Promise.resolve();
    },
  });
  Object.defineProperty(AgentSession.prototype, "stop", {
    configurable: true,
    async value(this: AgentSession) {
      this.removeAllListeners();
      await Promise.resolve();
    },
  });
  try {
    await manager.createRootChat(
      "workspace",
      "root",
      "Review",
      "codex",
      "gpt-5.4",
    );
    await store.updateChatState("workspace", "root", {
      providerState: { sessionId: "codex-thread" },
      eveState: { cursor: "remote-cursor" },
    });
    const first = await manager.ensureRootChat(cmo, "root", {
      driver: "codex",
      model: "gpt-5.4",
      access: "guarded",
      workspaceId: "workspace",
      executionOwner: "interactive",
    });
    const second = await manager.switchRootChatExecution(cmo, "root", {
      driver: "remote",
      model: "anthropic/claude-sonnet-4.6",
      access: "guarded",
      workspaceId: "workspace",
      executionOwner: "interactive",
    });

    assert.notEqual(first, second);
    assert.equal(startCount, 2);
    const stored = await store.chatRecord("workspace", "root");
    assert.ok(stored);
    assert.equal(stored.provider, "remote");
    assert.equal(stored.model, "anthropic/claude-sonnet-4.6");
    assert.equal(stored.providerState, undefined);
    assert.equal(stored.eveState, undefined);
  } finally {
    await manager.stopAll();
    if (originalStart) {
      Object.defineProperty(AgentSession.prototype, "start", originalStart);
    }
    if (originalStop) {
      Object.defineProperty(AgentSession.prototype, "stop", originalStop);
    }
    rmSync(directory, { recursive: true, force: true });
  }
});

void test("switching a channel responder keeps its transcript and adopts the tagged persona", async () => {
  const directory = mkdtempSync(join(tmpdir(), "chief-manager-responder-"));
  const store = new LocalStore(join(directory, "chief.sqlite"));
  const manager = new SessionManager(store);
  const originalStart = Object.getOwnPropertyDescriptor(
    AgentSession.prototype,
    "start",
  );
  const originalStop = Object.getOwnPropertyDescriptor(
    AgentSession.prototype,
    "stop",
  );
  Object.defineProperty(AgentSession.prototype, "start", {
    configurable: true,
    async value() {
      await Promise.resolve();
    },
  });
  Object.defineProperty(AgentSession.prototype, "stop", {
    configurable: true,
    async value(this: AgentSession) {
      this.removeAllListeners();
      await Promise.resolve();
    },
  });
  try {
    await manager.createRootChat(
      "workspace",
      "channel-chat",
      "General",
      "codex",
    );
    const first = await manager.ensureRootChat(cmo, "channel-chat", {
      driver: "codex",
      access: "guarded",
      workspaceId: "workspace",
      executionOwner: "interactive",
    });
    first.recordUserMessage("Shared channel context", "message-1");
    await manager.waitForChatPersistence("workspace", "channel-chat");

    const analyst: AgentDefinition = {
      id: "analyst",
      name: "Analyst",
      role: "Marketing analyst",
      description: "Explains performance.",
      instructions: "Answer as the analyst.",
    };
    const second = await manager.switchRootChatAgent(analyst, "channel-chat", {
      driver: "codex",
      access: "guarded",
      workspaceId: "workspace",
      executionOwner: "interactive",
    });

    assert.notEqual(first, second);
    assert.equal(second.agent.id, "analyst");
    assert.ok(
      second.events.some(
        (event) =>
          event.type === "message" &&
          event.id === "message-1" &&
          event.role === "user",
      ),
    );
    assert.equal(
      (await store.chatRecord("workspace", "channel-chat"))?.agent,
      "analyst",
    );
  } finally {
    await manager.stopAll();
    if (originalStart) {
      Object.defineProperty(AgentSession.prototype, "start", originalStart);
    }
    if (originalStop) {
      Object.defineProperty(AgentSession.prototype, "stop", originalStop);
    }
    rmSync(directory, { recursive: true, force: true });
  }
});

void test("action.raise persists its session source and rejects cross-workspace sources", async () => {
  const directory = mkdtempSync(join(tmpdir(), "chief-manager-action-"));
  const store = new LocalStore(join(directory, "chief.sqlite"));
  const manager = new SessionManager(store);
  try {
    await manager.createRootChat("workspace-a", "session-a", "A", "codex");
    await manager.createRootChat("workspace-b", "session-b", "B", "codex");
    const raise = (sourceId: string) =>
      handleLocalTool(
        new Request("http://localhost/local-tools/action", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            title: "Review the launch",
            reason: "Choose whether the launch should proceed this afternoon.",
            sourceId,
          }),
        }),
        "workspace-a",
        manager,
      );

    const response = await raise("session-a");
    assert.equal(response.status, 200);
    assert.equal(
      (await manager.workspaceData("workspace-a")).actionItems[0]?.sourceId,
      "session-a",
    );

    const rejected = await raise("session-b");
    assert.equal(rejected.status, 400);
    assert.match(await rejected.text(), /not found in this workspace/);

    const productSource = await raise("automation-launch-plan");
    assert.equal(productSource.status, 200);
    assert.ok(
      (await manager.workspaceData("workspace-a")).actionItems.some(
        (item) => item.sourceId === "automation-launch-plan",
      ),
    );
    assert.match(
      JSON.stringify(localToolsOpenApi("http://localhost")),
      /sourceId/,
    );

    const structured = () =>
      handleLocalTool(
        new Request("http://localhost/local-tools/action", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            title: "Connect analytics",
            reason:
              "Chief needs read-only analytics credentials to run the approved growth report.",
            sourceId: "session-a",
            dedupeKey: "connect-analytics",
            request: {
              steps: [
                {
                  text: "Open Google Cloud credentials.",
                  url: "https://console.cloud.google.com/apis/credentials",
                },
              ],
              questions: [
                {
                  header: "Property",
                  question: "Which property should Chief report on?",
                  options: [{ label: "Program" }, { label: "Another" }],
                },
              ],
              fields: [
                {
                  key: "clientSecret",
                  label: "Client secret",
                  type: "secret",
                  save: { envKey: "GOOGLE_ANALYTICS_CLIENT_SECRET" },
                },
              ],
            },
          }),
        }),
        "workspace-a",
        manager,
      );
    const firstStructured = await structured();
    const secondStructured = await structured();
    assert.equal(firstStructured.status, 200);
    assert.equal(secondStructured.status, 200);
    const firstStructuredBody = (await firstStructured.json()) as {
      actionItem: { id: string };
    };
    const secondStructuredBody = (await secondStructured.json()) as {
      actionItem: { id: string };
    };
    assert.equal(
      firstStructuredBody.actionItem.id,
      secondStructuredBody.actionItem.id,
    );
    const storedStructured = (
      await manager.workspaceData("workspace-a")
    ).actionItems.filter((item) => item.title === "Connect analytics");
    assert.equal(storedStructured.length, 1);
    assert.equal(storedStructured[0]?.request?.questions?.length, 1);
    const collision = await handleLocalTool(
      new Request("http://localhost/local-tools/action", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: "Connect Reddit",
          reason: "Chief needs Reddit access to complete source monitoring.",
          sourceId: "session-a",
          dedupeKey: "connect-analytics",
        }),
      }),
      "workspace-a",
      manager,
    );
    assert.equal(collision.status, 400);
    assert.match(await collision.text(), /dedupeKey collision/);
    assert.equal(
      (await manager.workspaceData("workspace-a")).actionItems.filter(
        (item) => item.sourceId === "session-a",
      ).length,
      2,
    );
    const analytics = await handleLocalTool(
      new Request("http://localhost/local-tools/action", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: "Allow Chief to read Google Analytics",
          reason:
            "Google Analytics is not connected, so Chief cannot verify acquisition reporting.",
          sourceId: "session-a",
          dedupeKey: "setup:analytics.googleapis.com",
          request: {
            steps: [
              {
                text: "Open Google Cloud **credentials**.",
                url: "https://console.cloud.google.com/apis/credentials",
              },
            ],
            fields: [
              {
                key: "clientId",
                label: "Client ID",
                type: "text",
                save: { envKey: "GOOGLE_ANALYTICS_CLIENT_ID" },
              },
              {
                key: "clientSecret",
                label: "Client secret",
                type: "secret",
                save: { envKey: "GOOGLE_ANALYTICS_CLIENT_SECRET" },
              },
            ],
          },
        }),
      }),
      "workspace-a",
      manager,
    );
    assert.equal(analytics.status, 200);
    const analyticsBody = (await analytics.json()) as {
      actionItem: {
        request?: {
          steps?: { text: string; url?: string }[];
          fields: { key: string; save: { envKey: string } }[];
        };
      };
    };
    const analyticsRequest = analyticsBody.actionItem.request;
    assert.ok(analyticsRequest);
    assert.deepEqual(analyticsRequest.steps, [
      {
        text: "Open Google Cloud **credentials**.",
        url: "https://console.cloud.google.com/apis/credentials",
      },
    ]);
    assert.deepEqual(
      analyticsRequest.fields.map((field) => [field.key, field.save.envKey]),
      [
        ["clientId", "GOOGLE_ANALYTICS_CLIENT_ID"],
        ["clientSecret", "GOOGLE_ANALYTICS_CLIENT_SECRET"],
      ],
    );
    assert.match(
      JSON.stringify(localToolsOpenApi("http://localhost")),
      /dedupeKey|questions|envKey/,
    );
  } finally {
    await manager.stopAll();
    rmSync(directory, { recursive: true, force: true });
  }
});
