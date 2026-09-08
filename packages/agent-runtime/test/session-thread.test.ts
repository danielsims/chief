import assert from "node:assert/strict";
import test from "node:test";

import type { AgentDefinition } from "../src/types.js";
import { BaseDriver } from "../src/drivers/base.js";
import { AgentSession } from "../src/session.js";

const cmo: AgentDefinition = {
  id: "chief",
  name: "Chief",
  role: "Chief",
  description: "Runs marketing work.",
  instructions: "Run the requested work.",
};
const tinyPng =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

class TestDriver extends BaseDriver {
  readonly prompts: string[] = [];
  onPrompt: (() => void) | undefined;
  start() {
    return Promise.resolve();
  }
  sendPromptOnce(prompt: string) {
    this.prompts.push(prompt);
    this.onPrompt?.();
    return Promise.resolve();
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
}
void test("recorded channel membership retains its durable UI action", () => {
  const session = new AgentSession(cmo, "chat", {
    driver: "codex",
    access: "guarded",
    workspaceId: "workspace",
  });
  session.recordUserMessage(
    "Workspace Owner added Analyst to the channel.",
    "membership-event",
    {
      mentions: ["analyst"],
      channelAction: {
        type: "member-added",
        actorName: "Workspace Owner",
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
    actorName: "Workspace Owner",
    agentIds: ["analyst"],
  });
});

void test("a host-owned document keeps its exact channel thread", () => {
  const session = new AgentSession(cmo, "document-chat", {
    driver: "codex",
    access: "guarded",
    workspaceId: "workspace",
  });
  session.recordAssistantMessage(
    [
      {
        type: "data-document",
        id: "document-brand-profile",
        data: {
          fileId: "brand-profile",
          title: "Working brand profile.md",
          path: "brand/working-brand-profile.md",
          kind: "document",
          versionId: "version-1",
        },
      },
    ],
    {
      id: "specialist-file:brand-profile",
      threadRootId: "brand-thread",
    },
  );

  const event = session.events.at(-1);
  if (event?.type !== "message") assert.fail("Expected a document message.");
  assert.equal(event.id, "specialist-file:brand-profile");
  assert.equal(event.threadRootId, "brand-thread");
  assert.equal(event.content[0]?.type, "data-document");
});

void test("an attached image is materialized for the agent to inspect", async () => {
  const driver = new TestDriver();
  const session = new AgentSession(
    cmo,
    "image-chat",
    {
      driver: "codex",
      access: "guarded",
      workspaceId: "workspace",
    },
    [],
    driver,
  );
  await session.start("/tmp");

  await session.sendPrompt("What is this?", "image-message", true, {
    mentions: ["chief"],
    attachments: [
      { name: "reference.png", mediaType: "image/png", url: tinyPng },
    ],
  });

  assert.match(driver.prompts[0] ?? "", /inspect these files/u);
  assert.match(
    driver.prompts[0] ?? "",
    /reference\.png: \/tmp\/\.message-attachments\/.*\.png/u,
  );
  const event = session.events.at(-1);
  if (event?.type !== "message") assert.fail("Expected an image message.");
  assert.equal(event.content.at(-1)?.type, "image");
});

void test("a later agent reply receives images from the current thread", async () => {
  const driver = new TestDriver();
  const session = new AgentSession(
    cmo,
    "thread-image-chat",
    {
      driver: "codex",
      access: "guarded",
      workspaceId: "workspace",
    },
    [],
    driver,
  );
  session.recordUserMessage("What is this?", "thread-root", {
    attachments: [{ name: "thread.png", mediaType: "image/png", url: tinyPng }],
  });
  await session.start("/tmp");

  await session.sendPrompt("@Chief please take a look", "thread-reply", true, {
    threadRootId: "thread-root",
    mentions: ["chief"],
  });

  assert.match(driver.prompts[0] ?? "", /Current channel thread context/u);
  assert.match(
    driver.prompts[0] ?? "",
    /thread\.png: \/tmp\/\.message-attachments\/.*\.png/u,
  );
  assert.match(driver.prompts[0] ?? "", /What is this\?/u);
});

void test("a newly addressed channel thread receives the recent shared channel context", async () => {
  const driver = new TestDriver();
  const session = new AgentSession(
    cmo,
    "channel-context-chat",
    {
      driver: "codex",
      access: "guarded",
      workspaceId: "workspace",
    },
    [],
    driver,
  );
  session.recordUserMessage(
    "The app still crashes whenever the agent opens its browser.",
    "previous-channel-message",
  );
  session.recordUserMessage(
    "@Chief see my last message",
    "addressed-thread-root",
    { mentions: ["chief"] },
  );
  await session.start("/tmp");

  await session.sendPrompt(
    "@Chief see my last message",
    "addressed-thread-root",
    false,
    {
      threadRootId: "addressed-thread-root",
      mentions: ["chief"],
    },
  );

  assert.match(driver.prompts[0] ?? "", /Recent shared channel context/u);
  assert.match(driver.prompts[0] ?? "", /still crashes whenever/u);
  assert.match(driver.prompts[0] ?? "", /Current channel thread context/u);
  assert.match(driver.prompts[0] ?? "", /see my last message/u);
});

void test("the thread anchor survives a driver exit via the persisted getter", async () => {
  const driver = new TestDriver();
  const session = new AgentSession(
    cmo,
    "thread-anchor-chat",
    {
      driver: "codex",
      access: "guarded",
      workspaceId: "workspace",
    },
    [],
    driver,
  );
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
  const driver = new TestDriver();
  const session = new AgentSession(
    cmo,
    "thread-approval-chat",
    {
      driver: "codex",
      access: "guarded",
      workspaceId: "workspace",
    },
    [],
    driver,
  );
  driver.onPrompt = () => {
    driver.emit("event", {
      type: "permission",
      requestId: "approval-1",
      toolName: "GitHub",
      input: { message: "Connect GitHub" },
    });
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
