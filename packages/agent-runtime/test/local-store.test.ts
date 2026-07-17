import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createClient } from "@libsql/client";

import type { LocalMessage } from "../src/local-store.js";
import { LocalStore } from "../src/local-store.js";

const encryptionKey = "chief-runtime-integration-test-encryption-key";
process.env.CHIEF_DATABASE_ENCRYPTION_KEY = encryptionKey;

function fixture(name: string) {
  const directory = mkdtempSync(join(tmpdir(), `chief-${name}-`));
  const path = join(directory, "chief.sqlite");
  return { directory, path, store: new LocalStore(path) };
}

void test("root chat lists exclude private roots and child executions", async () => {
  const { directory, store } = fixture("chat-tree");
  try {
    await store.createChat({
      id: "root",
      workspaceId: "workspace-a",
      visibility: "user",
      agent: "cmo",
      provider: "codex",
      model: "gpt-5",
      providerState: { sessionId: "provider-thread" },
      eveState: { executionId: "eve-execution" },
      title: "Root conversation",
    });
    await store.createChat({
      id: "child",
      workspaceId: "workspace-a",
      parentId: "root",
      triggerId: "message-1",
      visibility: "private",
      agent: "research",
      provider: "claude",
    });
    await store.createChat({
      id: "background",
      workspaceId: "workspace-a",
      visibility: "private",
      agent: "scheduler",
      provider: "codex",
    });

    assert.deepEqual(
      (await store.listChats("workspace-a")).map((chat) => chat.id),
      ["root"],
    );
    const children = await store.listChildChats("workspace-a", "root");
    assert.equal(children.length, 1);
    assert.equal(children[0]?.id, "child");
    assert.equal(children[0].triggerId, "message-1");
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
      workspaceId: "workspace-a",
      visibility: "user",
      agent: "general",
      provider: "codex",
    });
    await store.saveMessages("workspace-a", "root", [
      {
        id: "message-1",
        chatId: "root",
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
        workspaceId: "workspace-b",
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
      workspaceId: "workspace",
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
      workspaceId: "workspace",
      visibility: "user",
      agent: "general",
      provider: "codex",
    });
    interface Metadata {
      source: "slack";
      thread: string;
    }
    const messages: LocalMessage<Metadata>[] = [
      {
        id: "assistant-id",
        chatId: "root",
        role: "assistant",
        parts: [{ type: "text", text: "Second" }],
        metadata: { source: "slack", thread: "123" },
        position: 1,
        createdAt: 20,
      },
      {
        id: "user-id",
        chatId: "root",
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

    const stored = await store.messages<Metadata>("workspace", "root");
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
  };
  const result = { type: "result" as const, ok: true, durationMs: 42 };
  const context = {
    id: "root",
    workspaceId: "workspace",
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
    const resultUiMessage = uiMessages[2];
    assert.ok(firstUiMessage);
    assert.ok(resultUiMessage?.metadata);
    assert.equal(firstUiMessage.id, "client-message-id");
    assert.deepEqual(firstUiMessage.parts, first.content);
    assert.deepEqual(resultUiMessage.metadata.event, result);
    assert.equal(typeof resultUiMessage.metadata.createdAt, "number");
    const transcript = await store.transcript("workspace", "root");
    assert.deepEqual(
      transcript.flatMap((event) =>
        event.type === "message" ? [event.id] : [],
      ),
      initialIds,
    );
    assert.deepEqual(transcript.at(-1), result);
  } finally {
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

void test("UI history merges tool output into the stable assistant message", async () => {
  const { directory, store } = fixture("ui-tool-history");
  const context = {
    id: "root",
    workspaceId: "workspace",
    agentId: "cmo",
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
      workspaceId: "workspace",
      visibility: "user",
      agent: "general",
      provider: "codex",
    });
    await store.createChat({
      id: "child",
      workspaceId: "workspace",
      parentId: "root",
      visibility: "private",
      agent: "research",
      provider: "claude",
    });
    await store.saveMessages("workspace", "child", [
      {
        id: "child-message",
        chatId: "child",
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

void test("baseline contains only the required singular one-word tables", async () => {
  const { directory, path, store } = fixture("table-names");
  const client = createClient({ url: `file:${path}`, encryptionKey });
  try {
    await store.health();
    const result = await client.execute(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle_%' ORDER BY name",
    );
    assert.deepEqual(
      result.rows.map((row) => {
        assert.equal(typeof row.name, "string");
        return row.name;
      }),
      [
        "attention",
        "campaign",
        "chat",
        "content",
        "file",
        "message",
        "preference",
        "prospect",
        "run",
        "schedule",
        "trend",
        "version",
      ],
    );
  } finally {
    client.close();
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

void test("attention ids cannot cross workspace boundaries", async () => {
  const { directory, store } = fixture("attention-workspace-isolation");
  try {
    await store.raiseAttentionItem("workspace-a", {
      id: "shared-id",
      agentId: "analyst",
      title: "A only",
      reason: "Private reason",
      status: "open",
      createdAt: 1,
    });
    await assert.rejects(
      store.raiseAttentionItem("workspace-b", {
        id: "shared-id",
        agentId: "content",
        title: "Overwrite",
        reason: "Wrong workspace",
        status: "open",
        createdAt: 2,
      }),
      /different workspace/,
    );
    assert.deepEqual(await store.listAttentionItems("workspace-a"), [
      {
        id: "shared-id",
        agentId: "analyst",
        title: "A only",
        reason: "Private reason",
        sourceId: undefined,
        status: "open",
        createdAt: 1,
      },
    ]);
    assert.deepEqual(await store.listAttentionItems("workspace-b"), []);
  } finally {
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

void test("schedules and runs link one top-level CMO chat", async () => {
  const { directory, store } = fixture("schedule-chat");
  try {
    await store.createChat({
      id: "root",
      workspaceId: "workspace",
      visibility: "user",
      agent: "cmo",
      provider: "codex",
    });
    await store.createChat({
      id: "child",
      workspaceId: "workspace",
      parentId: "root",
      visibility: "private",
      agent: "analyst",
      provider: "codex",
    });
    const work = {
      id: "weekly-report",
      chatId: "root",
      agentId: "analyst",
      title: "Weekly report",
      instructions: "Review the week.",
      cron: "0 9 * * 1",
      timezone: "UTC",
      status: "active" as const,
      placement: "local" as const,
      approvalSummary: "Read the approved report sources.",
      proposedToolPatterns: [],
      grant: { version: 1 as const, approvedAt: 1, toolPatterns: [] },
      nextRunAt: 2,
      createdAt: 1,
      updatedAt: 1,
    };
    await store.saveRecurringWork("workspace", work);
    assert.deepEqual(await store.listChats("workspace"), []);
    const run = {
      id: "run-1",
      recurringWorkId: work.id,
      chatId: work.chatId,
      status: "running" as const,
      scheduledFor: 2,
      startedAt: 3,
    };
    assert.equal(
      await store.startRecurringWorkRun("workspace", run, {
        expectedNextRunAt: 2,
        nextRunAt: null,
      }),
      true,
    );
    assert.equal(
      (await store.listRecurringWorkRuns("workspace"))[0]?.chatId,
      "root",
    );

    await assert.rejects(
      store.saveRecurringWork("workspace", {
        ...work,
        id: "child-work",
        chatId: "child",
      }),
      /top-level CMO chat/,
    );
    await assert.rejects(
      store.saveRecurringWorkRun("workspace", {
        ...run,
        id: "run-2",
        chatId: "child",
      }),
      /does not match/,
    );
    await assert.rejects(
      store.deleteChat("workspace", "root"),
      /Schedule chats cannot be deleted/,
    );
    assert.ok(await store.chatRecord("workspace", "root"));
  } finally {
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
