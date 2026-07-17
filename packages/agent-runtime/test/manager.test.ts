import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { LocalStore } from "../src/local-store.js";
import { SessionManager } from "../src/manager.js";
import { scheduledAgentConfig } from "../src/scheduled-agent-config.js";

process.env.CHIEF_DATABASE_ENCRYPTION_KEY =
  "chief-runtime-integration-test-encryption-key";

void test("private children are inspect-only and cannot be composed as roots", async () => {
  const directory = mkdtempSync(join(tmpdir(), "chief-manager-"));
  const store = new LocalStore(join(directory, "chief.sqlite"));
  const manager = new SessionManager(store);
  try {
    await store.createChat({
      id: "root",
      workspaceId: "workspace-a",
      visibility: "user",
      agent: "cmo",
      provider: "codex",
    });
    await store.createChat({
      id: "child",
      workspaceId: "workspace-a",
      parentId: "root",
      visibility: "private",
      agent: "analyst",
      provider: "codex",
    });

    assert.equal(
      (await manager.inspectChat("workspace-a", "child")).chat.agent,
      "analyst",
    );
    await assert.rejects(
      manager.rootChat("workspace-a", "child"),
      /top-level user-visible CMO chat/,
    );
    await assert.rejects(
      manager.inspectChat("workspace-b", "child"),
      /not found in this workspace/,
    );
  } finally {
    await manager.stopAll();
    rmSync(directory, { recursive: true, force: true });
  }
});

void test("schedule execution always resolves the CMO provider", async () => {
  const directory = mkdtempSync(join(tmpdir(), "chief-schedule-owner-"));
  const store = new LocalStore(join(directory, "chief.sqlite"));
  const manager = new SessionManager(store);
  try {
    await manager.saveAgentPreference("workspace", {
      agentId: "cmo",
      enabled: true,
      driver: "codex",
      model: "root-model",
    });
    await manager.saveAgentPreference("workspace", {
      agentId: "analyst",
      enabled: true,
      driver: "claude",
      model: "specialist-model",
    });
    const config = await scheduledAgentConfig(manager, "workspace", {
      id: "report",
      chatId: "root",
      agentId: "analyst",
      title: "Report",
      instructions: "Review the data.",
      cron: "0 9 * * 1",
      timezone: "UTC",
      status: "active",
      placement: "local",
      approvalSummary: "Read approved data.",
      proposedToolPatterns: [],
      createdAt: 1,
      updatedAt: 1,
    });

    assert.ok(config);
    assert.equal(config.agent.id, "cmo");
    assert.equal(config.preference.driver, "codex");
    assert.equal(config.preference.model, "root-model");
  } finally {
    await manager.stopAll();
    rmSync(directory, { recursive: true, force: true });
  }
});

void test("schedule and interactive execution ownership cannot overlap", async () => {
  const directory = mkdtempSync(join(tmpdir(), "chief-execution-owner-"));
  const store = new LocalStore(join(directory, "chief.sqlite"));
  const manager = new SessionManager(store);
  try {
    await store.createChat({
      id: "schedule-root",
      workspaceId: "workspace",
      visibility: "user",
      agent: "cmo",
      provider: "codex",
    });
    await store.saveRecurringWork("workspace", {
      id: "report",
      chatId: "schedule-root",
      agentId: "analyst",
      title: "Report",
      instructions: "Review the data.",
      cron: "0 9 * * 1",
      timezone: "UTC",
      status: "active",
      placement: "local",
      approvalSummary: "Read approved data.",
      proposedToolPatterns: [],
      grant: { version: 1, approvedAt: 1, toolPatterns: [] },
      nextRunAt: 2,
      createdAt: 1,
      updatedAt: 1,
    });
    assert.equal(
      await store.startRecurringWorkRun("workspace", {
        id: "active-run",
        recurringWorkId: "report",
        chatId: "schedule-root",
        status: "running",
        scheduledFor: 2,
        startedAt: 2,
      }),
      true,
    );

    const releaseInteractive = manager.acquireExecution(
      "workspace",
      "ordinary-root",
      "interactive",
    );
    assert.throws(
      () => manager.acquireExecution("workspace", "ordinary-root", "schedule"),
      /already running interactive work/,
    );
    releaseInteractive();
    manager.acquireExecution("workspace", "interrupt-root", "interactive");
    manager.releaseExecution("workspace", "interrupt-root", "interactive");
    const releaseAfterInterrupt = manager.acquireExecution(
      "workspace",
      "interrupt-root",
      "interactive",
    );
    releaseAfterInterrupt();
    const releaseSchedule = manager.acquireExecution(
      "workspace",
      "ordinary-root",
      "schedule",
    );
    assert.throws(
      () =>
        manager.acquireExecution("workspace", "ordinary-root", "interactive"),
      /already running schedule work/,
    );
    releaseSchedule();

    const releaseActiveSchedule = manager.acquireExecution(
      "workspace",
      "schedule-root",
      "schedule",
    );
    assert.throws(
      () =>
        manager.assertExecutionAvailable(
          "workspace",
          "schedule-root",
          "interactive",
        ),
      /owned by schedule work/,
    );
    await assert.rejects(
      manager.assertInteractiveChat("workspace", "schedule-root"),
      /Schedule chats are read-only/,
    );
    releaseActiveSchedule();
  } finally {
    await manager.stopAll();
    rmSync(directory, { recursive: true, force: true });
  }
});
