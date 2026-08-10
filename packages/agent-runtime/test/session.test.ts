import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
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
const tinyPng =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

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

void test("private turn instructions reach the provider without entering the transcript", async () => {
  const session = new AgentSession(cmo, "chat", {
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
  await session.sendPrompt("Connect GitHub.", "message", true, {
    privateInstructions: "Use the private GitHub setup recipe.",
  });

  assert.match(prompts[0] ?? "", /private GitHub setup recipe/u);
  assert.match(prompts[0] ?? "", /Never quote, paraphrase, summarize/u);
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
  assert.equal(nextMessage.threadRootId, undefined);
});

void test("assistant message events receive a stable id for channel mirroring", () => {
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

  driver.emit("event", {
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
    typeof recorded.id === "string" && recorded.id.length > 0,
    "assistant message should be stamped with an id",
  );
});

void test("send marker flushes mid-turn messages without duplicating the final", async () => {
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

  await session.sendPrompt("Set up analytics", "user-1");
  driver.emit("event", {
    type: "stream",
    text: "On it, setting up now. [message:send]",
  });
  driver.emit("event", { type: "stream", text: "Opening the browser." });
  driver.emit("event", {
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
  assert.match(
    assistant[0]?.content.at(-1)?.type === "text"
      ? (assistant[0].content.at(-1) as { text: string }).text
      : "",
    /On it, setting up now/,
  );
  assert.ok(
    typeof assistant[0]?.id === "string" && assistant[0].id.length > 0,
    "flushed message should carry an id",
  );
});

void test("legacy channel send marker still flushes a message", async () => {
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

  await session.sendPrompt("Set up analytics", "user-1");
  driver.emit("event", {
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

  await session.sendPrompt("Open the browser", "user-1");
  driver.emit("event", { type: "stream", text: "On it, opening the browser." });
  driver.emit("event", {
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
