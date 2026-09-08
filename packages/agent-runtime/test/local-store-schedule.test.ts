import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { LocalStore } from "../src/local-store.js";

const encryptionKey = "chief-runtime-integration-test-encryption-key";
process.env.CHIEF_DATABASE_ENCRYPTION_KEY = encryptionKey;

function fixture(name: string) {
  const directory = mkdtempSync(join(tmpdir(), `chief-${name}-`));
  const path = join(directory, "chief.sqlite");
  return { directory, path, store: new LocalStore(path) };
}

void test("action ids cannot cross workspace boundaries", async () => {
  const { directory, store } = fixture("action-workspace-isolation");
  try {
    await store.raiseActionItem("workspace-a", {
      id: "shared-id",
      agentId: "analyst",
      title: "A only",
      reason: "Private reason",
      threadRootId: "thread-a",
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
        threadRootId: "thread-a",
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

void test("resolved action decisions remain in workspace history", async () => {
  const { directory, store } = fixture("resolved-action-history");
  try {
    const action = {
      id: "decision",
      agentId: "chief",
      title: "Choose a direction",
      reason: "One decision is needed.",
      threadRootId: "thread-a",
      request: {
        id: "request",
        title: "Choose a direction",
        fields: [],
        questions: [
          {
            question: "Which direction?",
            options: [{ label: "Connect GitHub" }],
          },
        ],
      },
      status: "open" as const,
      createdAt: 1,
    };
    await store.raiseActionItem("workspace-a", action);
    await store.raiseActionItem("workspace-a", {
      ...action,
      status: "resolved",
      resolution: {
        answers: { "Which direction?": "Connect GitHub" },
        resolvedAt: 2,
        resolvedBy: { id: "workspace-owner", name: "Workspace" },
      },
    });

    assert.deepEqual(await store.listActionItems("workspace-a"), []);
    assert.deepEqual(await store.listWorkspaceActionItems("workspace-a"), [
      {
        ...action,
        status: "resolved",
        sourceId: undefined,
        resolution: {
          answers: { "Which direction?": "Connect GitHub" },
          resolvedAt: 2,
          resolvedBy: { id: "workspace-owner", name: "Workspace" },
        },
      },
    ]);
    await store.dismissActionItem("workspace-a", "decision");
    assert.deepEqual(await store.listWorkspaceActionItems("workspace-a"), []);
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
      agent: "chief",
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
      agent: "chief",
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
    assert.equal(stored.agent, "chief");
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
      /top-level user-visible Chief conversation/,
    );
    await store.deleteRecurringWork("workspace", work.id);
    assert.deepEqual(await store.listScheduleSessions("workspace"), []);
    assert.ok(await store.chatRecord("workspace", "root"));
  } finally {
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

void test("a workspace schedule can migrate to its replacement channel conversation", async () => {
  const { directory, store } = fixture("schedule-conversation-migration");
  try {
    for (const id of ["retired-setup", "mission-control"]) {
      await store.createChat({
        id,
        organizationId: "workspace",
        visibility: "user",
        agent: "chief",
        provider: "codex",
      });
    }
    const work = {
      id: "workspace-onboarding-weekly-review",
      conversationId: "retired-setup",
      agentId: "chief",
      title: "Weekly review",
      instructions: "Review current work.",
      cron: "0 9 * * 1",
      timezone: "UTC",
      status: "active" as const,
      placement: "local" as const,
      approvalSummary: "Review workspace activity.",
      proposedToolPatterns: [],
      grant: { version: 1 as const, approvedAt: 1, toolPatterns: [] },
      nextAt: 2,
      createdAt: 1,
      updatedAt: 1,
    };
    await store.saveRecurringWork("workspace", work);
    await store.saveRecurringWork("workspace", {
      ...work,
      conversationId: "mission-control",
      updatedAt: 2,
    });
    assert.equal(
      (await store.listRecurringWork("workspace"))[0]?.conversationId,
      "mission-control",
    );
  } finally {
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
