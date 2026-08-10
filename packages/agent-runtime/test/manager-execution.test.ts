import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { AgentDefinition } from "../src/types.js";
import { LocalStore } from "../src/local-store.js";
import { handleLocalTool, localToolsOpenApi } from "../src/local-tools.js";
import { SessionManager } from "../src/manager.js";
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
    assert.match(second.agent.instructions, /direct localTools\.\* tools/);
    assert.match(second.agent.instructions, /never search Executor/);
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

void test("agent-bound local tools do not replace an unchanged live session", async () => {
  const directory = mkdtempSync(join(tmpdir(), "chief-manager-local-mcp-"));
  const store = new LocalStore(join(directory, "chief.sqlite"));
  const manager = new SessionManager(store);
  const originalStart = Object.getOwnPropertyDescriptor(
    AgentSession.prototype,
    "start",
  );
  let startCount = 0;
  Object.defineProperty(AgentSession.prototype, "start", {
    configurable: true,
    value() {
      startCount += 1;
      return Promise.resolve();
    },
  });
  manager.setSessionEnvironmentProvider(() => ({
    CHIEF_LOCAL_URL: "http://127.0.0.1:4318",
    CHIEF_LOCAL_CAPABILITY: "stable-agent-capability",
  }));
  try {
    const config = {
      driver: "codex" as const,
      access: "guarded" as const,
      workspaceId: "workspace",
      executionOwner: "interactive" as const,
    };
    const first = await manager.ensureRootChat(cmo, "root", config, "Review");
    const second = await manager.ensureRootChat(cmo, "root", config, "Review");

    assert.equal(first, second);
    assert.equal(startCount, 1);
    assert.deepEqual(first.config.mcpServers, [
      {
        name: "chief_local",
        command: "",
        args: [],
        url: "http://127.0.0.1:4318/agent-local-mcp",
        headers: { Authorization: "Bearer stable-agent-capability" },
      },
    ]);
  } finally {
    if (originalStart) {
      Object.defineProperty(AgentSession.prototype, "start", originalStart);
    }
    await manager.stopAll();
    await store.close();
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
