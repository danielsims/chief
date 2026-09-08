import assert from "node:assert/strict";
import test from "node:test";

import { isJsonString } from "@chief/relay-contracts";

import type {
  AgentDefinition,
  AgentEvent,
  StartOptions,
} from "../src/types.js";
import { BaseDriver } from "../src/drivers/base.js";
import { remoteHistoryContext } from "../src/drivers/remote-history.js";
import { AgentSession } from "../src/session.js";

const cmo: AgentDefinition = {
  id: "chief",
  name: "Chief",
  role: "Chief",
  description: "Runs marketing work.",
  instructions: "Run the requested work.",
};

class TestDriver extends BaseDriver {
  readonly prompts: string[] = [];
  startedWith: StartOptions | undefined;
  sendFailure: Error | undefined;

  start(options: StartOptions) {
    this.startedWith = options;
    return Promise.resolve();
  }

  sendPromptOnce(prompt: string) {
    this.prompts.push(prompt);
    return this.sendFailure
      ? Promise.reject(this.sendFailure)
      : Promise.resolve();
  }

  restart() {
    return Promise.resolve();
  }
  interrupt() {
    return Promise.resolve();
  }
  stop() {
    return Promise.resolve();
  }

  emitAgentEvent(event: AgentEvent) {
    this.emit("event", event);
  }
}
void test("a fresh local provider receives normalized history without persisting the wrapper", async () => {
  const history: AgentEvent[] = [
    {
      type: "message",
      role: "user",
      content: [{ type: "text", text: "Remember the launch is Tuesday." }],
    },
    {
      type: "message",
      role: "assistant",
      content: [{ type: "text", text: "I will plan around Tuesday." }],
    },
  ];
  const driver = new TestDriver();
  const session = new AgentSession(
    cmo,
    "chat",
    {
      driver: "codex",
      access: "guarded",
      workspaceId: "workspace",
    },
    history,
    driver,
  );

  await session.start("/tmp");
  await session.sendPrompt("What should we publish?");

  assert.match(driver.prompts[0] ?? "", /Remember the launch is Tuesday/);
  assert.match(driver.prompts[0] ?? "", /What should we publish/);
  const last = session.events.at(-1);
  if (last?.type !== "message") assert.fail("Expected the raw user message.");
  assert.deepEqual(last.content, [
    { type: "text", text: "What should we publish?" },
  ]);
});

void test("private turn instructions reach the provider without entering the transcript", async () => {
  const driver = new TestDriver();
  const session = new AgentSession(
    cmo,
    "chat",
    {
      driver: "codex",
      access: "guarded",
      workspaceId: "workspace",
    },
    [],
    driver,
  );

  await session.start("/tmp");
  await session.sendPrompt("Connect GitHub.", "message", true, {
    privateInstructions: "Use the private GitHub setup recipe.",
  });

  assert.match(driver.prompts[0] ?? "", /private GitHub setup recipe/u);
  assert.match(driver.prompts[0] ?? "", /inspect the user-owned source files/u);
  assert.match(driver.prompts[0] ?? "", /Do not disclose credentials/u);
  const recorded = session.events.at(-1);
  if (recorded?.type !== "message") {
    assert.fail("Expected the visible user message.");
  }
  assert.deepEqual(recorded.content, [
    { type: "text", text: "Connect GitHub." },
  ]);
});

void test("remote history omits a pre-recorded copy of the current prompt", () => {
  const history: AgentEvent[] = [
    {
      type: "message",
      role: "user",
      content: [{ type: "text", text: "Earlier question" }],
    },
    {
      type: "message",
      role: "assistant",
      content: [{ type: "text", text: "Earlier answer" }],
    },
    {
      type: "message",
      role: "user",
      content: [{ type: "text", text: "Run the kickoff" }],
    },
  ];

  const context = remoteHistoryContext(history, "Run the kickoff") ?? "";
  assert.match(context, /Earlier question/);
  assert.match(context, /Earlier answer/);
  assert.doesNotMatch(context, /Run the kickoff/);
});

void test("session passes dynamic runtime context separately from instructions", async () => {
  const driver = new TestDriver();
  const session = new AgentSession(
    cmo,
    "chat",
    {
      driver: "remote",
      access: "guarded",
      workspaceId: "workspace",
      runtimeContext: "Session chat belongs to conversation root.",
    },
    [],
    driver,
  );

  await session.start("/tmp");

  assert.ok(driver.startedWith, "driver should receive its start options");
  assert.equal(
    driver.startedWith.runtimeContext,
    "Session chat belongs to conversation root.",
  );
  assert.equal(driver.startedWith.instructions, "Run the requested work.");
});

void test("a rejected provider send does not leave the session busy", async () => {
  const driver = new TestDriver();
  driver.sendFailure = new Error("deployment missing");
  const session = new AgentSession(
    cmo,
    "chat",
    {
      driver: "remote",
      access: "guarded",
      workspaceId: "workspace",
    },
    [],
    driver,
  );
  await session.start("/tmp");

  await assert.rejects(() => session.sendPrompt("Hello"), /deployment missing/);
  assert.equal(session.isBusy, false);
});

void test("late assistant content stays with the turn that completed", async () => {
  const driver = new TestDriver();
  const session = new AgentSession(
    cmo,
    "chat",
    {
      driver: "codex",
      access: "guarded",
      workspaceId: "workspace",
    },
    [],
    driver,
  );

  await session.sendPrompt("Research this", "user-message", true, {
    threadRootId: "thread-root",
  });
  driver.emitAgentEvent({ type: "result", ok: true });
  driver.emitAgentEvent({
    type: "message",
    role: "assistant",
    content: [{ type: "text", text: "The final result" }],
  });

  const finalMessage = session.events.at(-1);
  if (finalMessage?.type !== "message") {
    assert.fail("Expected the final assistant message.");
  }
  assert.equal(finalMessage.threadRootId, "thread-root");

  await session.sendPrompt("A new turn", "next-message");
  driver.emitAgentEvent({
    type: "message",
    role: "assistant",
    content: [{ type: "text", text: "A new answer" }],
  });
  const nextMessage = session.events.at(-1);
  if (nextMessage?.type !== "message") {
    assert.fail("Expected the next assistant message.");
  }
  assert.equal(nextMessage.threadRootId, undefined);
});

void test("assistant message events receive a stable id for channel mirroring", () => {
  const driver = new TestDriver();
  const session = new AgentSession(
    cmo,
    "chat",
    {
      driver: "codex",
      access: "guarded",
      workspaceId: "workspace",
    },
    [],
    driver,
  );

  driver.emitAgentEvent({
    type: "message",
    role: "assistant",
    content: [{ type: "text", text: "The reply" }],
  });

  const recorded = session.events.find(
    (event): event is Extract<AgentEvent, { type: "message" }> =>
      event.type === "message" && event.role === "assistant",
  );
  assert.ok(recorded, "assistant message should be recorded");
  assert.ok(
    isJsonString(recorded.id) && recorded.id.length > 0,
    "assistant message should be stamped with an id",
  );
});

void test("send marker flushes mid-turn messages without duplicating the final", async () => {
  const driver = new TestDriver();
  const session = new AgentSession(
    cmo,
    "chat",
    {
      driver: "codex",
      access: "guarded",
      workspaceId: "workspace",
    },
    [],
    driver,
  );

  await session.sendPrompt("Set up analytics", "user-1");
  driver.emitAgentEvent({
    type: "stream",
    text: "On it, setting up now. [message:send]",
  });
  driver.emitAgentEvent({ type: "stream", text: "Opening the browser." });
  driver.emitAgentEvent({
    type: "message",
    role: "assistant",
    content: [
      { type: "text", text: "On it, setting up now. Opening the browser." },
    ],
  });

  const assistant = session.events.filter(
    (event): event is Extract<AgentEvent, { type: "message" }> =>
      event.type === "message" && event.role === "assistant",
  );
  assert.equal(assistant.length, 2, "one flushed message plus the final tail");
  const firstText = assistant[0]?.content.at(-1);
  assert.match(
    firstText?.type === "text" ? firstText.text : "",
    /On it, setting up now/,
  );
  assert.ok(
    isJsonString(assistant[0]?.id) && assistant[0].id.length > 0,
    "flushed message should carry an id",
  );
});

void test("legacy channel send marker still flushes a message", async () => {
  const driver = new TestDriver();
  const session = new AgentSession(
    cmo,
    "chat",
    {
      driver: "codex",
      access: "guarded",
      workspaceId: "workspace",
    },
    [],
    driver,
  );

  await session.sendPrompt("Set up analytics", "user-1");
  driver.emitAgentEvent({
    type: "stream",
    text: "Quick update. [channel:send]",
  });

  const assistant = session.events.filter(
    (event): event is Extract<AgentEvent, { type: "message" }> =>
      event.type === "message" && event.role === "assistant",
  );
  assert.equal(assistant.length, 1);
});

void test("text before a tool call surfaces as its own message", async () => {
  const driver = new TestDriver();
  const session = new AgentSession(
    cmo,
    "chat",
    {
      driver: "codex",
      access: "guarded",
      workspaceId: "workspace",
    },
    [],
    driver,
  );

  await session.sendPrompt("Open the browser", "user-1");
  driver.emitAgentEvent({
    type: "stream",
    text: "On it, opening the browser.",
  });
  driver.emitAgentEvent({
    type: "message",
    role: "assistant",
    content: [
      { type: "tool_use", id: "tool-1", name: "browser.open", input: {} },
    ],
  });
  driver.emit("event", {
    type: "message",
    role: "user",
    content: [
      { type: "tool_result", tool_use_id: "tool-1", content: "opened" },
    ],
  });
  driver.emit("event", { type: "stream", text: "Done." });
  driver.emit("event", {
    type: "message",
    role: "assistant",
    content: [{ type: "text", text: "On it, opening the browser. Done." }],
  });
  driver.emit("event", { type: "result", ok: true });

  const assistant = session.events.filter(
    (event): event is Extract<AgentEvent, { type: "message" }> =>
      event.type === "message" && event.role === "assistant",
  );
  const texts = assistant
    .flatMap((event) =>
      event.content.flatMap((block) =>
        block.type === "text" ? [block.text] : [],
      ),
    )
    .join(" | ");
  // Narration before the tool call is flushed, the final tail is flushed, and
  // the provider's full-text message must not add a third duplicate.
  assert.match(texts, /On it, opening the browser/);
  assert.match(texts, /Done/);
  assert.ok(!assistant.some((event) => event.content.length === 0));
});

void test("narration between tool calls streams as its own messages", async () => {
  const driver = new TestDriver();
  const session = new AgentSession(
    cmo,
    "chat",
    {
      driver: "codex",
      access: "guarded",
      workspaceId: "workspace",
    },
    [],
    driver,
  );

  await session.sendPrompt("Set up analytics", "user-1");
  // Opening confirmation, then three tool calls each preceded by narration the
  // model streams before the tool boundary.
  driver.emit("event", {
    type: "stream",
    text: "I'll set that up for you now.",
  });
  driver.emit("event", {
    type: "message",
    role: "assistant",
    content: [{ type: "tool_use", id: "t1", name: "setup.list", input: {} }],
  });
  driver.emit("event", {
    type: "message",
    role: "user",
    content: [{ type: "tool_result", tool_use_id: "t1", content: "tasks" }],
  });
  driver.emit("event", { type: "stream", text: "Let me check the schema." });
  driver.emit("event", {
    type: "message",
    role: "assistant",
    content: [{ type: "tool_use", id: "t2", name: "setup.start", input: {} }],
  });
  driver.emit("event", {
    type: "message",
    role: "user",
    content: [{ type: "tool_result", tool_use_id: "t2", content: "started" }],
  });
  driver.emit("event", { type: "stream", text: "Let me authorize now." });
  driver.emit("event", {
    type: "message",
    role: "assistant",
    content: [{ type: "tool_use", id: "t3", name: "authorize", input: {} }],
  });
  driver.emit("event", {
    type: "message",
    role: "user",
    content: [{ type: "tool_result", tool_use_id: "t3", content: "ready" }],
  });
  driver.emit("event", {
    type: "message",
    role: "assistant",
    content: [
      {
        type: "text",
        text: "I'll set that up for you now. Let me check the schema. Let me authorize now.",
      },
    ],
  });
  driver.emit("event", { type: "result", ok: true });

  const assistant = session.events.filter(
    (event): event is Extract<AgentEvent, { type: "message" }> =>
      event.type === "message" && event.role === "assistant",
  );
  const texts = assistant
    .flatMap((event) =>
      event.content.flatMap((block) =>
        block.type === "text" ? [block.text] : [],
      ),
    )
    .join(" | ");
  // Narration streams at tool boundaries: the opening and each mid-turn
  // sentence surface as their own message, and the final message only carries
  // the un-flushed tail without duplicating what already streamed.
  assert.match(texts, /I'll set that up for you now/);
  assert.match(texts, /Let me check the schema/);
  assert.match(texts, /Let me authorize now/);
  assert.ok(
    texts.indexOf("I'll set that up for you now.") <
      texts.indexOf("Let me check the schema"),
    "the opening confirmation precedes the later narration",
  );
});
