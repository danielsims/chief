import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { LocalStore } from "../src/local-store.js";

process.env.CHIEF_DATABASE_ENCRYPTION_KEY =
  "chief-runtime-integration-test-encryption-key";

void test("concurrent specialist, transcript, and schedule writes share one local queue", async () => {
  const directory = mkdtempSync(join(tmpdir(), "chief-concurrent-store-"));
  const store = new LocalStore(join(directory, "chief.sqlite"));
  const taskIds = Array.from({ length: 16 }, (_, index) => `task-${index}`);
  try {
    await store.createChat({
      id: "root",
      organizationId: "workspace",
      visibility: "user",
      agent: "chief",
      provider: "codex",
    });
    for (const id of taskIds) {
      await store.createChat({
        id,
        organizationId: "workspace",
        parentId: "root",
        kind: "task",
        visibility: "private",
        agent: "analyst",
        provider: "codex",
      });
    }

    await Promise.all(
      taskIds.flatMap((id, index) => [
        store.saveTranscript(
          {
            id,
            organizationId: "workspace",
            parentId: "root",
            kind: "task",
            visibility: "private",
            agentId: "analyst",
            driver: "codex",
          },
          [
            {
              type: "message" as const,
              id: `prompt-${index}`,
              role: "user" as const,
              content: [{ type: "text" as const, text: `Run task ${index}.` }],
            },
            {
              type: "message" as const,
              id: `message-${index}`,
              role: "assistant" as const,
              content: [
                { type: "text" as const, text: `Completed task ${index}.` },
              ],
            },
          ],
        ),
        store.saveRecurringWork("workspace", {
          id: `schedule-${index}`,
          conversationId: "root",
          agentId: "analyst",
          title: `Schedule ${index}`,
          instructions: "Review the workspace.",
          cron: "0 9 * * 1",
          timezone: "UTC",
          status: "active" as const,
          placement: "local" as const,
          approvalSummary: "Review approved workspace data.",
          proposedToolPatterns: [],
          grant: { version: 1 as const, approvedAt: 1, toolPatterns: [] },
          nextAt: index + 1,
          createdAt: 1,
          updatedAt: 1,
        }),
      ]),
    );

    assert.equal((await store.listRecurringWork("workspace")).length, 16);
    assert.equal(
      (await store.transcript("workspace", "task-15")).at(-1)?.type,
      "message",
    );
  } finally {
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
