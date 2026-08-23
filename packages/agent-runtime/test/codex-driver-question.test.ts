import assert from "node:assert/strict";
import test from "node:test";

import type { AgentEvent } from "../src/types.js";
import { CodexDriver, prepareCodexEnvironment } from "../src/drivers/codex.js";

interface CodexAcpInternals {
  access: "full" | "guarded";
  handle(message: Record<string, unknown>): void;
  respond(id: number | string, result: unknown): void;
  restartIfNeeded(): Promise<void>;
  rpc(method: string, params: Record<string, unknown>): Promise<unknown>;
  sessionId?: string;
}

function internals(driver: CodexDriver) {
  return driver as unknown as CodexAcpInternals;
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
  const driver = new CodexDriver();
  const events: AgentEvent[] = [];
  driver.on("event", (event: AgentEvent) => events.push(event));
  const acp = internals(driver);

  acp.handle({
    method: "session/update",
    params: {
      update: {
        sessionUpdate: "agent_thought_chunk",
        content: { text: "Checking the workspace." },
      },
    },
  });
  acp.handle({
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
  acp.handle({
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
  const driver = new CodexDriver();
  const events: AgentEvent[] = [];
  const responses: unknown[] = [];
  driver.on("event", (event: AgentEvent) => events.push(event));
  const acp = internals(driver);
  acp.access = "guarded";
  acp.respond = (id, result) => responses.push({ id, result });

  acp.handle({
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
  assert.deepEqual(responses, [
    {
      id: 7,
      result: {
        outcome: { outcome: "selected", optionId: "allow-once" },
      },
    },
  ]);
});

void test("Codex ACP prompts and completes through one stable session", async () => {
  const driver = new CodexDriver();
  const events: AgentEvent[] = [];
  driver.on("event", (event: AgentEvent) => events.push(event));
  const acp = internals(driver);
  acp.sessionId = "session-1";
  acp.restartIfNeeded = () => Promise.resolve();
  acp.rpc = (method, params) => {
    assert.equal(method, "session/prompt");
    assert.deepEqual(params, {
      sessionId: "session-1",
      prompt: [{ type: "text", text: "Start onboarding" }],
    });
    return Promise.resolve({ stopReason: "end_turn" });
  };

  await driver.sendPromptOnce("Start onboarding");
  assert.ok(events.some((event) => event.type === "result" && event.ok));
});
