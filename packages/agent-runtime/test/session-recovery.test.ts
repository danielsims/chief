import assert from "node:assert/strict";
import test from "node:test";

import type { AgentDefinition, AgentEvent } from "../src/types.js";
import { AgentSession } from "../src/session.js";

const chief: AgentDefinition = {
  id: "chief",
  name: "Chief",
  role: "Chief",
  description: "Runs workspace operations.",
  instructions: "Complete the requested work.",
};

void test("a fresh continuation imports history when the user message was pre-recorded", async () => {
  const history: AgentEvent[] = [
    {
      type: "message",
      role: "assistant",
      content: [{ type: "text", text: "Earlier answer" }],
    },
    {
      type: "message",
      role: "user",
      content: [{ type: "text", text: "Please continue" }],
    },
  ];
  const session = new AgentSession(
    chief,
    "chat",
    { driver: "opencode", access: "guarded", workspaceId: "workspace" },
    history,
  );
  const prompts: string[] = [];
  const driver = {
    start: async () => Promise.resolve(),
    sendPrompt: (prompt: string) => {
      prompts.push(prompt);
      return Promise.resolve();
    },
  };
  (session as unknown as { driver: typeof driver }).driver = driver;

  await session.start("/tmp");
  await session.sendPrompt("Please continue", "user-message", false);

  assert.match(prompts[0] ?? "", /Earlier answer/);
  assert.equal(prompts[0]?.match(/Please continue/g)?.length, 1);
});

void test("a turn reports whether the provider produced agent output", async () => {
  const session = new AgentSession(chief, "chat", {
    driver: "opencode",
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
  let reply = false;
  driver.sendPrompt = () => {
    if (reply) {
      driver.emit("event", {
        type: "message",
        role: "assistant",
        content: [{ type: "text", text: "Here is the reply." }],
      });
    }
    driver.emit("event", { type: "result", ok: true });
    return Promise.resolve();
  };

  assert.equal(await session.sendPrompt("First attempt"), false);
  reply = true;
  assert.equal(await session.sendPrompt("Second attempt"), true);
});

void test("an interactive turn interrupts quickly after output stops", async () => {
  const session = new AgentSession(chief, "chat", {
    driver: "opencode",
    access: "guarded",
    workspaceId: "workspace",
    stallTimeoutMs: 20,
  });
  let rejectPrompt: ((error: Error) => void) | undefined;
  let interrupts = 0;
  const driver = {
    start: async () => Promise.resolve(),
    sendPrompt: () =>
      new Promise<void>((_resolve, reject) => {
        rejectPrompt = reject;
      }),
    interrupt: () => {
      interrupts += 1;
      rejectPrompt?.(new Error("provider interrupted"));
      return Promise.resolve();
    },
  };
  (session as unknown as { driver: typeof driver }).driver = driver;
  const events: AgentEvent[] = [];
  session.on("event", (event: AgentEvent) => events.push(event));

  await session.start("/tmp");
  await assert.rejects(
    () => session.sendPrompt("Please inspect this"),
    /provider interrupted/u,
  );

  assert.equal(interrupts, 1);
  assert.ok(
    events.some(
      (event) =>
        event.type === "error" &&
        event.message.includes("without any new output"),
    ),
  );
  assert.equal(session.isBusy, false);
});
