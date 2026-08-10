import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import type { AgentDefinition, AgentEvent } from "../src/types.js";
import { AgentSession } from "../src/session.js";

const cmo: AgentDefinition = {
  id: "cmo",
  name: "Chief",
  role: "CMO",
  description: "Runs marketing work.",
  instructions: "Run the requested work.",
};
const tinyPng =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
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

void test("an attached image is materialized for the agent to inspect", async () => {
  const session = new AgentSession(cmo, "image-chat", {
    driver: "codex",
    access: "guarded",
    workspaceId: "workspace",
  });
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

  await session.sendPrompt("What is this?", "image-message", true, {
    mentions: ["cmo"],
    attachments: [
      { name: "reference.png", mediaType: "image/png", url: tinyPng },
    ],
  });

  assert.match(prompts[0] ?? "", /inspect these files/u);
  assert.match(
    prompts[0] ?? "",
    /reference\.png: \/tmp\/\.message-attachments\/.*\.png/u,
  );
  const event = session.events.at(-1);
  if (event?.type !== "message") assert.fail("Expected an image message.");
  assert.equal(event.content.at(-1)?.type, "image");
});

void test("a later agent reply receives images from the current thread", async () => {
  const session = new AgentSession(cmo, "thread-image-chat", {
    driver: "codex",
    access: "guarded",
    workspaceId: "workspace",
  });
  session.recordUserMessage("What is this?", "thread-root", {
    attachments: [{ name: "thread.png", mediaType: "image/png", url: tinyPng }],
  });
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

  await session.sendPrompt("@Chief please take a look", "thread-reply", true, {
    threadRootId: "thread-root",
    mentions: ["cmo"],
  });

  assert.match(prompts[0] ?? "", /Current channel thread context/u);
  assert.match(
    prompts[0] ?? "",
    /thread\.png: \/tmp\/\.message-attachments\/.*\.png/u,
  );
  assert.match(prompts[0] ?? "", /What is this\?/u);
});

void test("a newly addressed channel thread receives the recent shared channel context", async () => {
  const session = new AgentSession(cmo, "channel-context-chat", {
    driver: "codex",
    access: "guarded",
    workspaceId: "workspace",
  });
  session.recordUserMessage(
    "The app still crashes whenever the agent opens its browser.",
    "previous-channel-message",
  );
  session.recordUserMessage(
    "@Chief see my last message",
    "addressed-thread-root",
    { mentions: ["cmo"] },
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

  await session.sendPrompt(
    "@Chief see my last message",
    "addressed-thread-root",
    false,
    {
      threadRootId: "addressed-thread-root",
      mentions: ["cmo"],
    },
  );

  assert.match(prompts[0] ?? "", /Recent shared channel context/u);
  assert.match(prompts[0] ?? "", /still crashes whenever/u);
  assert.match(prompts[0] ?? "", /Current channel thread context/u);
  assert.match(prompts[0] ?? "", /see my last message/u);
});

void test("the thread anchor survives a driver exit via the persisted getter", async () => {
  const session = new AgentSession(cmo, "thread-anchor-chat", {
    driver: "codex",
    access: "guarded",
    workspaceId: "workspace",
  });
  const driver = new EventEmitter() as EventEmitter & {
    start: () => Promise<void>;
    sendPrompt: (prompt: string) => Promise<void>;
  };
  driver.start = async () => Promise.resolve();
  driver.sendPrompt = async (prompt: string) => {
    void prompt;
    await Promise.resolve();
  };
  (session as unknown as { driver: typeof driver }).driver = driver;
  await session.start("/tmp");

  // First turn anchors the session to a thread.
  await session.sendPrompt("Set it up", "user-1", true, {
    threadRootId: "thread-root-1",
  });
  assert.equal(session.persistedThreadRootId, "thread-root-1");
  assert.equal(session.activeThreadRootId, "thread-root-1");

  // A driver exit clears the live reply context (as happens on restart), but
  // the persisted anchor must still resolve so a continuation keeps streaming
  // into the same thread.
  driver.emit("event", { type: "exit", code: 0 });
  driver.emit("event", { type: "status", status: "idle" });
  assert.equal(session.persistedThreadRootId, "thread-root-1");
  assert.equal(session.activeThreadRootId, "thread-root-1");
});

void test("an approval stays with the channel thread that requested it", async () => {
  const session = new AgentSession(cmo, "thread-approval-chat", {
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
  driver.sendPrompt = () => {
    driver.emit("event", {
      type: "permission",
      requestId: "approval-1",
      toolName: "GitHub",
      input: { message: "Connect GitHub" },
    });
    return Promise.resolve();
  };

  await session.sendPrompt("Review the repo", "thread-message", true, {
    threadRootId: "thread-root",
  });
  driver.emit("event", { type: "result", ok: true });

  const permission = session.events.find(
    (event) => event.type === "permission",
  );
  assert.equal(permission?.type, "permission");
  assert.equal(permission.threadRootId, "thread-root");
});
