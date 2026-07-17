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
      workspaceId: "workspace-a",
      visibility: "user",
      agent: "cmo",
      provider: "codex",
      title: "Growth report",
    });
    await store.saveTranscript(
      {
        id: "schedule-chat",
        workspaceId: "workspace-a",
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
          workspaceId: "workspace-b",
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
