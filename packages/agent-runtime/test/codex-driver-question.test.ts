import assert from "node:assert/strict";
import test from "node:test";

import type { JsonObject, JsonValue } from "@chief/relay-contracts";

import type { AgentEvent } from "../src/types.js";
import { CodexDriver, prepareCodexEnvironment } from "../src/drivers/codex.js";

class TestCodexDriver extends CodexDriver {
  readonly responses: { id: number | string; result: JsonValue | undefined }[] =
    [];
  rpcHandler?: (method: string, params: JsonObject) => JsonValue | undefined;

  receive(message: JsonObject): void {
    this.handle(message);
  }

  setAccess(access: "full" | "guarded"): void {
    this.access = access;
  }

  setSessionId(sessionId: string): void {
    this.sessionId = sessionId;
  }

  protected override restartIfNeeded(): Promise<void> {
    return Promise.resolve();
  }

  protected override rpc(
    method: string,
    params: JsonObject,
  ): Promise<JsonValue | undefined> {
    return Promise.resolve(this.rpcHandler?.(method, params));
  }

  protected override respond(
    id: number | string,
    result: JsonValue | undefined,
  ): void {
    this.responses.push({ id, result });
  }
}

void test("Codex ACP uses Chief's packaged compatible binary", () => {
  const environment: NodeJS.ProcessEnv = {
    CHIEF_CODEX_BINARY: process.execPath,
  };
  prepareCodexEnvironment(
    { cwd: process.cwd(), instructions: "Test", access: "guarded" },
    environment,
  );
  assert.equal(environment.CODEX_PATH, process.execPath);
});

void test("Codex ACP keeps thinking and tool calls in sequential activity", () => {
  const driver = new TestCodexDriver();
  const events: AgentEvent[] = [];
  driver.on("event", (event: AgentEvent) => events.push(event));

  driver.receive({
    method: "session/update",
    params: {
      update: {
        sessionUpdate: "agent_thought_chunk",
        content: { text: "Checking the workspace." },
      },
    },
  });
  driver.receive({
    method: "session/update",
    params: {
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "tool-1",
        title: "relay_channels_list",
        input: {},
      },
    },
  });
  driver.receive({
    method: "session/update",
    params: {
      update: {
        sessionUpdate: "tool_call_end",
        toolCallId: "tool-1",
        title: "relay_channels_list",
        status: "completed",
        result: '{"channels":[]}',
      },
    },
  });

  assert.deepEqual(events[0], {
    type: "thinkingStream",
    text: "Checking the workspace.",
  });
  assert.deepEqual(events[1], {
    type: "message",
    role: "assistant",
    content: [
      { type: "thinking", thinking: "Checking the workspace." },
      {
        type: "tool_use",
        id: "tool-1",
        name: "relay_channels_list",
        input: {},
      },
    ],
  });
  assert.deepEqual(events[2], {
    type: "message",
    role: "user",
    content: [
      {
        type: "tool_result",
        tool_use_id: "tool-1",
        content: '{"channels":[]}',
        is_error: false,
      },
    ],
  });
});

void test("Codex ACP routes guarded tool approval through Chief", () => {
  const driver = new TestCodexDriver();
  const events: AgentEvent[] = [];
  driver.on("event", (event: AgentEvent) => events.push(event));
  driver.setAccess("guarded");

  driver.receive({
    id: 7,
    method: "session/request_permission",
    params: {
      toolCall: { name: "relay_channels_list", input: {} },
      options: [
        { optionId: "allow-once", kind: "allow_once" },
        { optionId: "reject-once", kind: "reject_once" },
      ],
    },
  });
  const permission = events.find((event) => event.type === "permission");
  assert.equal(permission?.type, "permission");
  assert.equal(permission.toolName, "relay_channels_list");
  driver.respondPermission(permission.requestId, "allow");
  assert.deepEqual(driver.responses, [
    {
      id: 7,
      result: {
        outcome: { outcome: "selected", optionId: "allow-once" },
      },
    },
  ]);
});

void test("Codex ACP prompts and completes through one stable session", async () => {
  const driver = new TestCodexDriver();
  const events: AgentEvent[] = [];
  driver.on("event", (event: AgentEvent) => events.push(event));
  driver.setSessionId("session-1");
  driver.rpcHandler = (method, params) => {
    assert.equal(method, "session/prompt");
    assert.deepEqual(params, {
      sessionId: "session-1",
      prompt: [{ type: "text", text: "Start onboarding" }],
    });
    return { stopReason: "end_turn" };
  };

  await driver.sendPromptOnce("Start onboarding");
  assert.ok(events.some((event) => event.type === "result" && event.ok));
});

void test("Codex MCP approval preserves the adapter's server-qualified identity", () => {
  const driver = new TestCodexDriver();
  const events: AgentEvent[] = [];
  driver.on("event", (event: AgentEvent) => events.push(event));
  driver.setAccess("guarded");
  driver.receive({
    method: "session/update",
    params: {
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "exec-relay-list",
        kind: "execute",
        title: "mcp.chief_relay.channels_list",
        status: "in_progress",
        rawInput: {
          server: "chief_relay",
          tool: "channels_list",
          arguments: {},
        },
      },
    },
  });
  driver.receive({
    id: 8,
    method: "session/request_permission",
    params: {
      toolCall: {
        toolCallId: "exec-relay-list",
        kind: "execute",
        status: "pending",
      },
      _meta: { is_mcp_tool_approval: true },
      options: [
        { optionId: "allow_once", kind: "allow_once" },
        { optionId: "decline", kind: "reject_once" },
      ],
    },
  });
  const permission = events.find((event) => event.type === "permission");
  assert.equal(permission?.toolName, "mcp.chief_relay.channels_list");
  assert.ok(permission);
  driver.respondPermission(permission.requestId, "allow");
  assert.deepEqual(driver.responses[0]?.result, {
    outcome: { outcome: "selected", optionId: "allow_once" },
  });
});

void test("Codex budgets the full UTF-8 instruction file without reducing explicit larger budgets", () => {
  const instructions = "界".repeat(30_000);
  const environment: NodeJS.ProcessEnv = {};
  prepareCodexEnvironment(
    { cwd: process.cwd(), instructions, access: "guarded" },
    environment,
  );
  const config = JSON.parse(environment.CODEX_CONFIG ?? "{}") as {
    project_doc_max_bytes: number;
  };
  assert.ok(
    config.project_doc_max_bytes >= Buffer.byteLength(instructions, "utf8"),
  );
  const inherited: NodeJS.ProcessEnv = {
    CODEX_CONFIG: JSON.stringify({ project_doc_max_bytes: 200_000 }),
  };
  prepareCodexEnvironment(
    { cwd: process.cwd(), instructions: "short", access: "guarded" },
    inherited,
  );
  assert.equal(
    (
      JSON.parse(inherited.CODEX_CONFIG ?? "{}") as {
        project_doc_max_bytes: number;
      }
    ).project_doc_max_bytes,
    200_000,
  );
});

void test("Codex diagnostic notices never enter assistant messages or streams", async (t) => {
  const driver = new TestCodexDriver();
  const events: AgentEvent[] = [];
  driver.on("event", (event: AgentEvent) => events.push(event));
  driver.setSessionId("session-notices");
  const log = t.mock.method(console, "warn", () => undefined);
  driver.rpcHandler = () => {
    driver.receive({
      method: "session/update",
      params: {
        update: {
          sessionUpdate: "notice",
          severity: "warning",
          title: "Project instructions exceed the budget",
        },
      },
    });
    driver.receive({
      method: "session/update",
      params: {
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { text: "Hey!" },
        },
      },
    });
    return { stopReason: "end_turn" };
  };
  await driver.sendPromptOnce("hey");
  assert.equal(log.mock.callCount(), 1);
  assert.deepEqual(
    events.filter((event) => event.type === "stream"),
    [{ type: "stream", text: "Hey!" }],
  );
  assert.deepEqual(
    events.filter((event) => event.type === "message"),
    [
      {
        type: "message",
        role: "assistant",
        content: [{ type: "text", text: "Hey!" }],
      },
    ],
  );
});
