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
