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
      role: "user" as const,
      content: [{ type: "text" as const, text: "Run the growth report." }],
    },
  ];

  try {
    await store.saveTranscript(
      {
        id: "automation-run-1",
        workspaceId: "workspace-a",
        agentId: "analyst",
        driver: "codex",
      },
      events,
      "Growth report",
    );

    const chat = await store.chat("workspace-a", "automation-run-1");
    assert.ok(chat);
    assert.equal(chat.driver, "codex");
    assert.equal(chat.title, "Growth report");

    await assert.rejects(
      store.saveTranscript(
        {
          id: "automation-run-1",
          workspaceId: "workspace-b",
          agentId: "analyst",
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
      /different workspace/,
    );
    assert.deepEqual(
      await store.transcript("workspace-a", "automation-run-1"),
      events,
    );
    assert.deepEqual(
      await store.transcript("workspace-b", "automation-run-1"),
      [],
    );
  } finally {
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
