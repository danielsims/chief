/* eslint-disable max-lines */

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
      organizationId: "workspace-a",
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

    assert.deepEqual(
      (await store.listChats("workspace-a")).map((chat) => chat.id),
      ["root"],
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
    organizationId: "workspace",
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

void test("diagnostics are workspace scoped, redacted, capped, and leveled", async () => {
  const { directory, store } = fixture("diagnostics");
  try {
    await store.createChat({
      id: "diagnostic-session",
      organizationId: "workspace-a",
      visibility: "user",
      agent: "cmo",
      provider: "codex",
      lastText: "Useful context authorization=last-text-secret",
      summary: "Useful summary Bearer summary-secret",
      error: "Useful error token=error-secret",
    });
    await store.createChat({
      id: "other-session",
      organizationId: "workspace-b",
      visibility: "user",
      agent: "cmo",
      provider: "codex",
    });
    await store.saveDiagnosticEvent("workspace-a", "diagnostic-session", 0, {
      type: "permission",
      requestId: "permission-1",
      toolName: "analytics.read",
      input: {
        authorization: "Bearer private",
        nested: { apiKey: "also-private" },
      },
    });
    await store.saveDiagnosticEvent("workspace-a", "diagnostic-session", 1, {
      type: "message",
      role: "user",
      content: [{ type: "text", text: "x".repeat(70_000) }],
    });
    await store.saveDiagnosticEvent("workspace-a", "diagnostic-session", 2, {
      type: "error",
      message: "failed",
    });
    await store.saveDiagnosticEvent("workspace-a", "diagnostic-session", 3, {
      type: "stream",
      text: [
        "Useful diagnostic text",
        "Authorization: Bearer bearer-secret",
        "https://example.test/path?token=query-secret&view=useful",
        '{"apiKey":"json-secret"}',
        "client_secret=assignment-secret",
        "github_pat_1234567890abcdef",
        "sk-proj-1234567890abcdef",
      ].join(" "),
    });

    const diagnostics = await store.diagnostics("workspace-a");
    assert.deepEqual(
      diagnostics.sessions.map((session) => session.id),
      ["diagnostic-session"],
    );
    assert.deepEqual(
      diagnostics.events.map((event) => event.level),
      ["warn", "info", "error", "debug"],
    );
    const redacted = JSON.stringify(diagnostics.events[0]?.data);
    assert.ok(!redacted.includes("private"));
    assert.equal(redacted.match(/\[REDACTED\]/g)?.length, 2);
    const capped = JSON.stringify(diagnostics.events[1]?.data);
    assert.ok(Buffer.byteLength(capped, "utf8") <= 64 * 1024);
    assert.match(capped, /"truncated":true/);
    const arbitrary = JSON.stringify(diagnostics.events[3]?.data);
    assert.match(arbitrary, /Useful diagnostic text/);
    assert.match(arbitrary, /view=useful/);
    for (const secret of [
      "bearer-secret",
      "query-secret",
      "json-secret",
      "assignment-secret",
      "1234567890abcdef",
    ]) {
      assert.ok(!arbitrary.includes(secret), `${secret} was redacted`);
    }
    const diagnosticSession = diagnostics.sessions[0];
    assert.ok(diagnosticSession);
    assert.match(diagnosticSession.lastText ?? "", /Useful context/);
    assert.match(diagnosticSession.summary ?? "", /Useful summary/);
    assert.match(diagnosticSession.error ?? "", /Useful error/);
    assert.ok(!JSON.stringify(diagnosticSession).includes("secret"));
    assert.deepEqual(await store.diagnostics("missing-workspace"), {
      sessions: [],
      events: [],
    });
    await assert.rejects(
      store.saveDiagnosticEvent("workspace-b", "diagnostic-session", 3, {
        type: "stream",
        text: "wrong workspace",
      }),
      /not found in this workspace/,
    );
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
        "action",
        "campaign",
        "content",
        "dataset",
        "event",
        "file",
        "message",
        "preference",
        "prospect",
        "schedule",
        "session",
        "trend",
        "version",
      ],
    );
    for (const table of [
      "action",
      "campaign",
      "content",
      "dataset",
      "event",
      "file",
      "message",
      "preference",
      "prospect",
      "schedule",
      "session",
      "trend",
      "version",
    ]) {
      const columns = await client.execute(`PRAGMA table_info(${table})`);
      const names = columns.rows.map((row) => row.name);
      assert.ok(
        names.includes("organization_id"),
        `${table} has organization_id`,
      );
      assert.ok(
        !names.includes("workspace_id"),
        `${table} excludes workspace_id`,
      );
    }
    const messageColumns = await client.execute("PRAGMA table_info(message)");
    const messageNames = messageColumns.rows.map((row) => row.name);
    assert.ok(messageNames.includes("session_id"));
    assert.ok(!messageNames.includes("chat_id"));
    assert.ok(messageNames.includes("organization_id"));
    const eventColumns = await client.execute("PRAGMA table_info(event)");
    assert.ok(
      eventColumns.rows.map((row) => row.name).includes("organization_id"),
    );
    for (const table of ["file", "version"]) {
      const columns = await client.execute(`PRAGMA table_info(${table})`);
      const names = columns.rows.map((row) => row.name);
      assert.ok(names.includes("source_session_id"));
      assert.ok(!names.includes("source_run_id"));
    }
  } finally {
    client.close();
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

void test("an obsolete pre-release baseline is replaced on startup", async () => {
  const directory = mkdtempSync(join(tmpdir(), "chief-obsolete-baseline-"));
  const path = join(directory, "chief.sqlite");
  const obsoleteClient = createClient({
    url: `file:${path}`,
    encryptionKey,
  });
  await obsoleteClient.execute(
    "CREATE TABLE preference (organization_id text NOT NULL)",
  );
  obsoleteClient.close();

  const store = new LocalStore(path);
  let client: ReturnType<typeof createClient> | undefined;
  try {
    await store.health();
    client = createClient({ url: `file:${path}`, encryptionKey });
    const columns = await client.execute("PRAGMA table_info(message)");
    assert.ok(columns.rows.map((row) => row.name).includes("organization_id"));
  } finally {
    client?.close();
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

void test("action ids cannot cross workspace boundaries", async () => {
  const { directory, store } = fixture("action-workspace-isolation");
  try {
    await store.raiseActionItem("workspace-a", {
      id: "shared-id",
      agentId: "analyst",
      title: "A only",
      reason: "Private reason",
      status: "open",
      createdAt: 1,
    });
    await assert.rejects(
      store.raiseActionItem("workspace-b", {
        id: "shared-id",
        agentId: "content",
        title: "Overwrite",
        reason: "Wrong workspace",
        status: "open",
        createdAt: 2,
      }),
      /different workspace/,
    );
    assert.deepEqual(await store.listActionItems("workspace-a"), [
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
    assert.deepEqual(await store.listActionItems("workspace-b"), []);
    await store.dismissActionItem("workspace-a", "shared-id");
    assert.deepEqual(await store.listActionItems("workspace-a"), []);
  } finally {
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

void test("schedule occurrences are private task sessions under an optional conversation", async () => {
  const { directory, store } = fixture("schedule-session");
  try {
    await store.createChat({
      id: "root",
      organizationId: "workspace",
      visibility: "user",
      agent: "cmo",
      provider: "codex",
    });
    await store.createChat({
      id: "child",
      organizationId: "workspace",
      parentId: "root",
      visibility: "private",
      agent: "analyst",
      provider: "codex",
    });
    const work = {
      id: "weekly-report",
      conversationId: "root",
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
      nextAt: 2,
      createdAt: 1,
      updatedAt: 1,
    };
    await store.saveRecurringWork("workspace", work);
    assert.deepEqual(
      (await store.listChats("workspace")).map((chat) => chat.id),
      ["root"],
    );
    const session = {
      id: "session-1",
      parentId: "root",
      scheduleId: work.id,
      kind: "task" as const,
      visibility: "private" as const,
      agent: "cmo",
      title: "Weekly report",
      provider: "codex",
      status: "running" as const,
      scheduledFor: 2,
      startedAt: 3,
      attempt: 1,
      createdAt: 3,
      updatedAt: 3,
    };
    assert.equal(
      await store.startScheduleSession("workspace", session, {
        expectedNextAt: 2,
        nextAt: null,
      }),
      true,
    );
    const [stored] = await store.listScheduleSessions("workspace");
    assert.ok(stored);
    assert.equal(stored.parentId, "root");
    assert.equal(stored.visibility, "private");
    assert.equal(stored.kind, "task");
    assert.equal(stored.agent, "cmo");

    await assert.rejects(
      store.deleteChat("workspace", "root"),
      /Workspace conversation is used by a Schedule/,
    );
    assert.ok(await store.chatRecord("workspace", "root"));
    assert.ok(await store.chatRecord("workspace", "session-1"));

    await assert.rejects(
      store.saveRecurringWork("workspace", {
        ...work,
        id: "child-work",
        conversationId: "child",
      }),
      /top-level user-visible CMO conversation/,
    );
    await store.deleteRecurringWork("workspace", work.id);
    assert.deepEqual(await store.listScheduleSessions("workspace"), []);
    assert.ok(await store.chatRecord("workspace", "root"));
  } finally {
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
