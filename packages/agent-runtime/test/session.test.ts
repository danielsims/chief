import assert from "node:assert/strict";
import test from "node:test";

import type { AgentDefinition, AgentEvent } from "../src/types.js";
import { remoteHistoryContext } from "../src/drivers/remote-history.js";
import { AgentSession } from "../src/session.js";

const cmo: AgentDefinition = {
  id: "cmo",
  name: "Chief",
  role: "CMO",
  description: "Runs marketing work.",
  instructions: "Run the requested work.",
};

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
  const session = new AgentSession(
    cmo,
    "chat",
    {
      driver: "codex",
      access: "guarded",
      workspaceId: "workspace",
    },
    history,
  );
  const prompts: string[] = [];
  const driver = {
    start: async () => Promise.resolve(),
    sendPrompt: async (prompt: string) => {
      prompts.push(prompt);
      await Promise.resolve();
    },
  };
  (session as unknown as { driver: typeof driver }).driver = driver;

  await session.start("/tmp");
  await session.sendPrompt("What should we publish?");

  assert.match(prompts[0] ?? "", /Remember the launch is Tuesday/);
  assert.match(prompts[0] ?? "", /What should we publish/);
  const last = session.events.at(-1);
  if (last?.type !== "message") assert.fail("Expected the raw user message.");
  assert.deepEqual(last.content, [
    { type: "text", text: "What should we publish?" },
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
  const session = new AgentSession(cmo, "chat", {
    driver: "remote",
    access: "guarded",
    workspaceId: "workspace",
    runtimeContext: "Session chat belongs to conversation root.",
  });
  let startedWith: unknown;
  const driver = {
    start: (options: unknown) => {
      startedWith = options;
      return Promise.resolve();
    },
  };
  (session as unknown as { driver: typeof driver }).driver = driver;

  await session.start("/tmp");

  assert.equal(
    (startedWith as { runtimeContext?: string }).runtimeContext,
    "Session chat belongs to conversation root.",
  );
  assert.equal(
    (startedWith as { instructions?: string }).instructions,
    "Run the requested work.",
  );
});

void test("a rejected provider send does not leave the session busy", async () => {
  const session = new AgentSession(cmo, "chat", {
    driver: "remote",
    access: "guarded",
    workspaceId: "workspace",
  });
  const driver = {
    start: async () => Promise.resolve(),
    sendPrompt: async () => Promise.reject(new Error("deployment missing")),
  };
  (session as unknown as { driver: typeof driver }).driver = driver;
  await session.start("/tmp");

  await assert.rejects(() => session.sendPrompt("Hello"), /deployment missing/);
  assert.equal(session.isBusy, false);
});

void test("late assistant content stays with the turn that completed", async () => {
  const session = new AgentSession(cmo, "chat", {
    driver: "codex",
    access: "guarded",
    workspaceId: "workspace",
  });
  const driver = (
    session as unknown as {
      driver: {
        emit: (type: "event", event: AgentEvent) => void;
        sendPrompt: (prompt: string) => Promise<void>;
      };
    }
  ).driver;
  driver.sendPrompt = async () => Promise.resolve();

  await session.sendPrompt("Research this", "user-message", true, {
    threadRootId: "thread-root",
  });
  driver.emit("event", { type: "result", ok: true });
  driver.emit("event", {
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
  driver.emit("event", {
    type: "message",
    role: "assistant",
    content: [{ type: "text", text: "A new answer" }],
  });
  const nextMessage = session.events.at(-1);
  if (nextMessage?.type !== "message") {
    assert.fail("Expected the next assistant message.");
  }
  assert.equal(nextMessage.threadRootId, "next-message");
});

void test("recorded channel membership retains its durable UI action", () => {
  const session = new AgentSession(cmo, "chat", {
    driver: "codex",
    access: "guarded",
    workspaceId: "workspace",
  });
  session.recordUserMessage(
    "Daniel Sims added Analyst to the channel.",
    "membership-event",
    {
      mentions: ["analyst"],
      channelAction: {
        type: "member-added",
        actorName: "Daniel Sims",
        agentIds: ["analyst"],
      },
    },
  );

  const event = session.events.at(-1);
  if (event?.type !== "message") {
    assert.fail("Expected a membership message.");
  }
  assert.equal(event.id, "membership-event");
  assert.deepEqual(event.channelAction, {
    type: "member-added",
    actorName: "Daniel Sims",
    agentIds: ["analyst"],
  });
});
