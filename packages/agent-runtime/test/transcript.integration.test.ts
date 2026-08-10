import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { LocalStore } from "../src/local-store.js";

process.env.CHIEF_DATABASE_ENCRYPTION_KEY =
  "chief-runtime-integration-test-encryption-key";

void test("automation transcript metadata remains addressable and workspace-scoped", async () => {
  const directory = mkdtempSync(join(tmpdir(), "chief-transcript-"));
  const store = new LocalStore(join(directory, "chief.sqlite"));
  const events = [
    {
      type: "message" as const,
      id: "growth-report-request",
      role: "user" as const,
      content: [{ type: "text" as const, text: "Run the growth report." }],
    },
  ];

  try {
    await store.createChat({
      id: "schedule-chat",
      organizationId: "workspace-a",
      visibility: "user",
      agent: "cmo",
      provider: "codex",
      title: "Growth report",
    });
    await store.saveTranscript(
      {
        id: "schedule-chat",
        organizationId: "workspace-a",
        agentId: "cmo",
        driver: "codex",
      },
      events,
      "Growth report",
    );

    const chat = await store.chat("workspace-a", "schedule-chat");
    assert.ok(chat);
    assert.equal(chat.driver, "codex");
    assert.equal(chat.title, "Growth report");

    await assert.rejects(
      store.saveTranscript(
        {
          id: "schedule-chat",
          organizationId: "workspace-b",
          agentId: "cmo",
          driver: "codex",
        },
        [
          {
            type: "message",
            role: "user",
            content: [{ type: "text", text: "Replace another workspace." }],
          },
        ],
      ),
      /identity does not match stored state/,
    );
    assert.deepEqual(
      await store.transcript("workspace-a", "schedule-chat"),
      events,
    );
    assert.deepEqual(
      await store.transcript("workspace-b", "schedule-chat"),
      [],
    );
  } finally {
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

void test("provider updates with one message id coalesce before persistence", async () => {
  const directory = mkdtempSync(join(tmpdir(), "chief-transcript-updates-"));
  const store = new LocalStore(join(directory, "chief.sqlite"));
  try {
    await store.createChat({
      id: "root",
      organizationId: "workspace-a",
      visibility: "user",
      agent: "cmo",
      provider: "codex",
      title: "Review",
    });
    await store.saveTranscript(
      {
        id: "root",
        organizationId: "workspace-a",
        agentId: "cmo",
        driver: "codex",
      },
      [
        {
          type: "message",
          id: "user-1",
          role: "user",
          content: [{ type: "text", text: "Start the review." }],
        },
        {
          type: "message",
          id: "assistant-1",
          role: "assistant",
          content: [{ type: "text", text: "I am checking." }],
        },
        {
          type: "message",
          id: "assistant-1",
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "tool-1",
              name: "search",
              input: { query: "Program" },
            },
          ],
        },
      ],
    );

    const messages = await store.uiMessages("workspace-a", "root");
    assert.equal(messages.length, 2);
    const assistant = messages[1];
    assert.ok(assistant);
    assert.equal(assistant.id, "assistant-1");
    assert.deepEqual(
      assistant.parts.map((part) => part.type),
      ["text", "dynamic-tool"],
    );
  } finally {
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

void test("a document produced by a user-role tool result stays with its assistant tool", async () => {
  const directory = mkdtempSync(join(tmpdir(), "chief-transcript-document-"));
  const store = new LocalStore(join(directory, "chief.sqlite"));
  try {
    await store.createChat({
      id: "root",
      organizationId: "workspace-a",
      visibility: "user",
      agent: "cmo",
      provider: "codex",
      title: "Review",
    });
    await store.saveTranscript(
      {
        id: "root",
        organizationId: "workspace-a",
        agentId: "cmo",
        driver: "codex",
      },
      [
        {
          type: "message",
          id: "user",
          role: "user",
          content: [{ type: "text", text: "Create the review." }],
        },
        {
          type: "message",
          id: "assistant-tool",
          role: "assistant",
          content: [
            { type: "tool_use", id: "write", name: "execute", input: {} },
          ],
        },
        {
          type: "message",
          id: "tool-result",
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "write", content: "saved" },
            {
              type: "data-document",
              id: "document-review",
              data: {
                fileId: "review",
                title: "Initial review.md",
                path: "reviews/initial-review.md",
                kind: "document",
                versionId: "v1",
              },
            },
          ],
        },
      ],
    );

    const messages = await store.uiMessages("workspace-a", "root");
    const assistant = messages.find(
      (message) => message.id === "assistant-tool",
    );
    assert.deepEqual(
      assistant?.parts.map((part) => part.type),
      ["dynamic-tool", "data-document"],
    );
    assert.equal(
      messages.some(
        (message) =>
          message.role === "user" &&
          message.parts.some((part) => part.type === "data-document"),
      ),
      false,
    );
  } finally {
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

void test("evolving provider events never reuse a persisted message id", async () => {
  const directory = mkdtempSync(join(tmpdir(), "chief-transcript-ids-"));
  const store = new LocalStore(join(directory, "chief.sqlite"));
  const context = {
    id: "root",
    organizationId: "workspace-a",
    agentId: "cmo",
    driver: "codex" as const,
  };
  try {
    await store.createChat({
      id: "root",
      organizationId: "workspace-a",
      visibility: "user",
      agent: "cmo",
      provider: "codex",
      title: "Review",
    });
    await store.saveTranscript(context, [
      {
        type: "message",
        id: "user",
        role: "user",
        content: [{ type: "text", text: "Start." }],
      },
      {
        type: "message",
        id: "shared",
        role: "assistant",
        content: [{ type: "text", text: "First update." }],
      },
      {
        type: "message",
        id: "other",
        role: "assistant",
        content: [{ type: "text", text: "Second update." }],
      },
    ]);
    await store.saveTranscript(context, [
      {
        type: "message",
        id: "user",
        role: "user",
        content: [{ type: "text", text: "Start." }],
      },
      { type: "result", ok: true },
      {
        type: "message",
        id: "other",
        role: "assistant",
        content: [{ type: "text", text: "Second update." }],
      },
      {
        type: "message",
        id: "shared",
        role: "assistant",
        content: [
          { type: "tool_use", id: "tool", name: "search", input: {} },
          { type: "tool_result", tool_use_id: "tool", content: "Done" },
        ],
      },
    ]);

    const messages = await store.uiMessages("workspace-a", "root");
    assert.equal(
      new Set(messages.map((message) => message.id)).size,
      messages.length,
    );
    const toolMessage = messages.find((message) =>
      message.parts.some((part) => part.type === "dynamic-tool"),
    );
    assert.equal(
      toolMessage?.parts.filter((part) => part.type === "dynamic-tool").length,
      1,
    );
  } finally {
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
