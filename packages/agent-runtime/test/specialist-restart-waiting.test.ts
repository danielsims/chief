import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { LocalStore } from "../src/local-store.js";

void test("restart reconciliation preserves a specialist waiting for the user", async () => {
  const directory = mkdtempSync(join(tmpdir(), "chief-waiting-restart-"));
  const store = new LocalStore(join(directory, "chief.sqlite"));
  try {
    await store.createChat({
      id: "root",
      organizationId: "workspace",
      kind: "conversation",
      visibility: "user",
      agent: "chief",
      provider: "codex",
      title: "Root",
    });
    await store.createChat({
      id: "waiting-child",
      organizationId: "workspace",
      parentId: "root",
      kind: "task",
      visibility: "private",
      agent: "setup",
      provider: "codex",
      title: "Sign in",
      status: "waiting",
      updatedAt: 1,
    });

    assert.equal(
      await store.reconcileInterruptedSpecialistSessions(Date.now()),
      0,
    );
    assert.equal(await store.reconcileStaleActivitySessions(Date.now()), 0);
    assert.equal(
      (await store.chatRecord("workspace", "waiting-child"))?.status,
      "waiting",
    );
  } finally {
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
