import assert from "node:assert/strict";
import test from "node:test";

import type { AgentEvent } from "../src/types.js";
import { CodexDriver } from "../src/drivers/codex.js";

void test("Codex request_user_input uses Chief's structured question UI", () => {
  const driver = new CodexDriver();
  const events: AgentEvent[] = [];
  const responses: unknown[] = [];
  driver.on("event", (event: AgentEvent) => events.push(event));

  const internals = driver as unknown as {
    handleMessage(message: unknown): void;
    write(message: unknown): void;
  };
  internals.write = (message) => responses.push(message);
  internals.handleMessage({
    id: 41,
    method: "item/tool/requestUserInput",
    params: {
      questions: [
        {
          id: "project",
          header: "Cloud project",
          question: "Which project should own this connection?",
          isOther: true,
          isSecret: false,
          options: [
            { label: "program-video", description: "Program Video" },
            { label: "Create new", description: "Create a project" },
          ],
        },
      ],
    },
  });

  assert.deepEqual(
    events.find((event) => event.type === "question"),
    {
      type: "question",
      requestId: "codex-input-41",
      questions: [
        {
          question: "Which project should own this connection?",
          header: "Cloud project",
          multiSelect: false,
          allowFreeform: true,
          dismissible: false,
          options: [
            { label: "program-video", description: "Program Video" },
            { label: "Create new", description: "Create a project" },
          ],
        },
      ],
    },
  );

  driver.respondQuestion("codex-input-41", {
    "Which project should own this connection?": "program-video",
  });
  assert.deepEqual(responses, [
    {
      jsonrpc: "2.0",
      id: 41,
      result: {
        answers: { project: { answers: ["program-video"] } },
      },
    },
  ]);
});

void test("Codex identifies plugin suggestions in approval events", () => {
  const driver = new CodexDriver();
  const events: AgentEvent[] = [];
  driver.on("event", (event: AgentEvent) => events.push(event));

  const internals = driver as unknown as {
    handleMessage(message: unknown): void;
    write(message: unknown): void;
  };
  internals.write = () => undefined;
  internals.handleMessage({
    id: 7,
    method: "mcpServer/elicitation/request",
    params: {
      _meta: {
        codex_approval_kind: "tool_suggestion",
        tool_name: "GitHub",
        suggest_reason: "Use GitHub to inspect commits.",
      },
      message: "Use GitHub to inspect commits.",
    },
  });

  const permission = events.find((event) => event.type === "permission");
  assert.equal(permission?.type, "permission");
  assert.equal(permission.toolName, "GitHub");
});

void test("Codex prompt stays active until the turn completes", async () => {
  const driver = new CodexDriver();
  const events: AgentEvent[] = [];
  driver.on("event", (event: AgentEvent) => events.push(event));

  const internals = driver as unknown as {
    handleMessage(message: unknown): void;
    rpc(method: string, params: unknown): Promise<unknown>;
  };
  internals.rpc = () => Promise.resolve({ turn: { id: "turn-1" } });

  let settled = false;
  const pending = driver.sendPromptOnce("Start onboarding").finally(() => {
    settled = true;
  });
  await Promise.resolve();
  assert.equal(settled, false);

  internals.handleMessage({
    method: "turn/completed",
    params: { turn: { id: "turn-1", status: "completed" } },
  });
  await pending;

  assert.equal(settled, true);
  assert.ok(events.some((event) => event.type === "result" && event.ok));
});

void test("Codex turn failure rejects without publishing a terminal result", async () => {
  const driver = new CodexDriver();
  const events: AgentEvent[] = [];
  driver.on("event", (event: AgentEvent) => events.push(event));

  const internals = driver as unknown as {
    handleMessage(message: unknown): void;
    rpc(method: string, params: unknown): Promise<unknown>;
  };
  internals.rpc = () => Promise.resolve({ turn: { id: "turn-2" } });

  const pending = driver.sendPromptOnce("Start onboarding");
  await Promise.resolve();
  internals.handleMessage({
    method: "turn/failed",
    params: { error: { message: "Codex is temporarily overloaded" } },
  });

  await assert.rejects(pending, /temporarily overloaded/);
  assert.equal(
    events.some((event) => event.type === "result"),
    false,
  );
});

void test("stopping Codex cancels an active prompt without restarting", async () => {
  const driver = new CodexDriver();
  let restarts = 0;
  const internals = driver as unknown as {
    rpc(method: string, params: unknown): Promise<unknown>;
    restart(): Promise<void>;
  };
  internals.rpc = () => Promise.resolve({ turn: { id: "turn-3" } });
  internals.restart = () => {
    restarts += 1;
    return Promise.resolve();
  };

  const pending = driver.sendPrompt("Start onboarding");
  await Promise.resolve();
  await driver.stop();
  await pending;

  assert.equal(restarts, 0);
});
