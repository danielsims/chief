import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import test from "node:test";

import type { JsonObject } from "@chief/relay-contracts";
import {
  isJsonNumber,
  isJsonString,
  parseJsonObject,
} from "@chief/relay-contracts";

import type { LocalMessage } from "../src/local-store.js";
import { LocalStore } from "../src/local-store.js";
import { localStoreFixture as fixture } from "./local-store-test-fixture.js";

void test("root chat lists exclude private roots and child executions", async () => {
  const { directory, store } = fixture("chat-tree");
  try {
    await store.createChat({
      id: "root",
      organizationId: "workspace-a",
      visibility: "user",
      agent: "chief",
      provider: "codex",
      model: "gpt-5",
      providerState: { sessionId: "provider-thread" },
      eveState: { executionId: "eve-execution" },
      title: "Root conversation",
    });
    await store.createChat({
      id: "child",
      organizationId: "workspace-a",
      parentId: "root",
      triggerId: "message-1",
      visibility: "private",
      agent: "research",
      provider: "claude",
      status: "failed",
      scheduledFor: 10,
      startedAt: 11,
      finishedAt: 12,
      attempt: 2,
      summary: "Research failed safely.",
      error: "Source unavailable.",
      artifacts: [
        {
          type: "data-document",
          data: {
            fileId: "file-1",
            title: "Research",
            path: "research.md",
            kind: "document",
            versionId: "version-1",
          },
        },
      ],
      blockedTools: ["tools.analytics.read"],
    });
    await store.createChat({
      id: "background",
      organizationId: "workspace-a",
      visibility: "private",
      agent: "scheduler",
      provider: "codex",
    });
    await store.createChat({
      id: "integration-setup-action-onboarding-google-analytics-test",
      organizationId: "workspace-a",
      visibility: "user",
      agent: "setup",
      provider: "claude",
      title: "Google Analytics setup",
    });
    await store.createChat({
      id: "analyst-direct-message",
      organizationId: "workspace-a",
      visibility: "user",
      agent: "analyst",
      provider: "codex",
      title: "Analyst",
    });

    assert.deepEqual(
      (await store.listChats("workspace-a")).map((chat) => chat.id).sort(),
      [
        "analyst-direct-message",
        "integration-setup-action-onboarding-google-analytics-test",
        "root",
      ],
    );
    const children = await store.listChildChats("workspace-a", "root");
    assert.equal(children.length, 1);
    const child = children[0];
    assert.ok(child);
    assert.equal(child.id, "child");
    assert.equal(child.organizationId, "workspace-a");
    assert.equal(child.kind, "task");
    assert.equal(child.triggerId, "message-1");
    assert.equal(child.status, "failed");
    assert.equal(child.scheduledFor, 10);
    assert.equal(child.startedAt, 11);
    assert.equal(child.finishedAt, 12);
    assert.equal(child.attempt, 2);
    assert.equal(child.summary, "Research failed safely.");
    assert.equal(child.error, "Source unavailable.");
    assert.equal(child.artifacts?.[0]?.type, "data-document");
    assert.deepEqual(child.blockedTools, ["tools.analytics.read"]);
    assert.deepEqual(
      (await store.chatRecord("workspace-a", "root"))?.providerState,
      {
        sessionId: "provider-thread",
      },
    );
    assert.deepEqual(
      (await store.chatRecord("workspace-a", "root"))?.eveState,
      {
        executionId: "eve-execution",
      },
    );
    assert.equal(
      (await store.chatRecord("workspace-a", "root"))?.kind,
      "conversation",
    );
  } finally {
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

void test("chat and message access is workspace isolated", async () => {
  const { directory, store } = fixture("workspace-isolation");
  try {
    await store.createChat({
      id: "root",
      organizationId: "workspace-a",
      visibility: "user",
      agent: "general",
      provider: "codex",
    });
    await store.saveMessages("workspace-a", "root", [
      {
        id: "message-1",
        sessionId: "root",
        role: "user",
        parts: [{ type: "text", text: "Private to A" }],
        position: 0,
        createdAt: 1,
      },
    ]);

    assert.equal(await store.chatRecord("workspace-b", "root"), null);
    assert.deepEqual(await store.messages("workspace-b", "root"), []);
    await store.deleteChat("workspace-b", "root");
    assert.ok(await store.chatRecord("workspace-a", "root"));
    await assert.rejects(
      store.createChat({
        id: "cross-workspace-child",
        organizationId: "workspace-b",
        parentId: "root",
        visibility: "private",
        agent: "research",
        provider: "claude",
      }),
      /different workspace/,
    );
  } finally {
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

void test("provider and Eve continuation state survives a store restart", async () => {
  const { directory, path, store: initialStore } = fixture("continuation");
  let store = initialStore;
  try {
    await store.createChat({
      id: "root",
      organizationId: "workspace",
      visibility: "user",
      agent: "general",
      provider: "codex",
    });
    await store.updateChatState("workspace", "root", {
      providerState: { sessionId: "thread-1", cursor: "next" },
      eveState: { executionId: "execution-1" },
      status: "waiting",
    });
    await store.close();

    store = new LocalStore(path);
    const chat = await store.chatRecord("workspace", "root");
    assert.deepEqual(chat?.providerState, {
      sessionId: "thread-1",
      cursor: "next",
    });
    assert.deepEqual(chat.eveState, { executionId: "execution-1" });
    assert.equal(chat.status, "waiting");
  } finally {
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

void test("messages preserve IDs, JSON parts, typed metadata, and position order", async () => {
  const { directory, store } = fixture("messages");
  try {
    await store.createChat({
      id: "root",
      organizationId: "workspace",
      visibility: "user",
      agent: "general",
      provider: "codex",
    });
    interface Metadata {
      source: "slack";
      thread: string;
    }
    const parseTestMessageMetadata = (
      value: JsonObject | undefined,
    ): Metadata | undefined => {
      const record = parseJsonObject(value);
      return record?.source === "slack" && isJsonString(record.thread)
        ? { source: record.source, thread: record.thread }
        : undefined;
    };
    const messages: LocalMessage<Metadata>[] = [
      {
        id: "assistant-id",
        sessionId: "root",
        role: "assistant",
        parts: [{ type: "text", text: "Second" }],
        metadata: { source: "slack", thread: "123" },
        position: 1,
        createdAt: 20,
      },
      {
        id: "user-id",
        sessionId: "root",
        role: "user",
        parts: [
          { type: "text", text: "First" },
          { type: "file", mediaType: "text/plain", url: "file:///brief.txt" },
        ],
        position: 0,
        createdAt: 10,
      },
    ];
    await store.saveMessages("workspace", "root", messages);

    const stored = await store.messages<Metadata>(
      "workspace",
      "root",
      parseTestMessageMetadata,
    );
    assert.deepEqual(
      stored.map(({ id, position }) => ({ id, position })),
      [
        { id: "user-id", position: 0 },
        { id: "assistant-id", position: 1 },
      ],
    );
    assert.deepEqual(stored[0]?.parts, messages[1]?.parts);
    assert.deepEqual(stored[1]?.metadata, {
      source: "slack",
      thread: "123",
    });
  } finally {
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

void test("transcript conversion keeps durable message IDs across saves", async () => {
  const { directory, store } = fixture("conversion");
  const first = {
    type: "message" as const,
    id: "client-message-id",
    role: "user" as const,
    content: [{ type: "text" as const, text: "Start" }],
  };
  const second = {
    type: "message" as const,
    role: "assistant" as const,
    content: [{ type: "text" as const, text: "Working" }],
    threadRootId: "client-message-id",
    mentions: ["analyst"],
  };
  const result = { type: "result" as const, ok: true, durationMs: 42 };
  const context = {
    id: "root",
    organizationId: "workspace",
    agentId: "general",
    driver: "codex" as const,
  };
  try {
    await store.saveTranscript(context, [first, second]);
    const initialIds = (await store.messages("workspace", "root")).map(
      (message) => message.id,
    );
    await store.saveTranscript(context, [first, second, result]);
    const stored = await store.messages("workspace", "root");

    assert.deepEqual(
      stored.slice(0, 2).map((message) => message.id),
      initialIds,
    );
    assert.deepEqual(stored[2]?.metadata, result);
    const uiMessages = await store.uiMessages("workspace", "root");
    const firstUiMessage = uiMessages[0];
    const secondUiMessage = uiMessages[1];
    const resultUiMessage = uiMessages[2];
    assert.ok(firstUiMessage);
    assert.ok(secondUiMessage?.metadata);
    assert.ok(resultUiMessage?.metadata);
    assert.equal(firstUiMessage.id, "client-message-id");
    assert.deepEqual(firstUiMessage.parts, first.content);
    assert.equal(secondUiMessage.metadata.threadRootId, "client-message-id");
    assert.deepEqual(secondUiMessage.metadata.mentions, ["analyst"]);
    assert.deepEqual(resultUiMessage.metadata.event, result);
    assert.ok(isJsonNumber(resultUiMessage.metadata.createdAt));
    const transcript = await store.transcript("workspace", "root");
    assert.deepEqual(
      transcript.flatMap((event) =>
        event.type === "message" ? [event.id] : [],
      ),
      initialIds,
    );
    assert.deepEqual(transcript.at(-1), result);
    const assistantReply = transcript.find(
      (event) => event.type === "message" && event.role === "assistant",
    );
    assert.ok(assistantReply?.type === "message");
    assert.deepEqual(
      { ...assistantReply, id: undefined },
      { ...second, id: undefined },
    );
  } finally {
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

void test("UI history merges tool output into the stable assistant message", async () => {
  const { directory, store } = fixture("ui-tool-history");
  const context = {
    id: "root",
    organizationId: "workspace",
    agentId: "chief",
    driver: "codex" as const,
  };
  try {
    await store.saveTranscript(context, [
      {
        type: "message",
        role: "user",
        content: [{ type: "text", text: "Check analytics" }],
      },
      {
        type: "message",
        role: "assistant",
        content: [
          { type: "tool_use", id: "call-1", name: "report", input: {} },
        ],
      },
    ]);
    const assistantId = (await store.uiMessages("workspace", "root"))[1]?.id;
    await store.saveTranscript(context, [
      {
        type: "message",
        role: "user",
        content: [{ type: "text", text: "Check analytics" }],
      },
      {
        type: "message",
        role: "assistant",
        content: [
          { type: "tool_use", id: "call-1", name: "report", input: {} },
        ],
      },
      {
        type: "message",
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "call-1",
            content: { sessions: 42 },
          },
        ],
      },
    ]);

    const messages = await store.uiMessages("workspace", "root");
    assert.equal(messages.length, 2);
    assert.equal(messages[1]?.id, assistantId);
    assert.deepEqual(messages[1]?.parts[0], {
      type: "dynamic-tool",
      toolName: "report",
      toolCallId: "call-1",
      state: "output-available",
      input: {},
      output: { sessions: 42 },
    });
  } finally {
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

void test("deleting a root cascades to child chats and all messages", async () => {
  const { directory, store } = fixture("cascade");
  try {
    await store.createChat({
      id: "root",
      organizationId: "workspace",
      visibility: "user",
      agent: "general",
      provider: "codex",
    });
    await store.createChat({
      id: "child",
      organizationId: "workspace",
      parentId: "root",
      visibility: "private",
      agent: "research",
      provider: "claude",
    });
    await store.saveMessages("workspace", "child", [
      {
        id: "child-message",
        sessionId: "child",
        role: "assistant",
        parts: [{ type: "text", text: "Finding" }],
        position: 0,
        createdAt: 1,
      },
    ]);

    await store.deleteChat("workspace", "root");
    assert.equal(await store.chatRecord("workspace", "child"), null);
    assert.deepEqual(await store.messages("workspace", "child"), []);
  } finally {
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
