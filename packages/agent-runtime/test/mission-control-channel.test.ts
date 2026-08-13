import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { LocalStore } from "../src/local-store.js";

process.env.CHIEF_DATABASE_ENCRYPTION_KEY =
  "chief-mission-control-channel-test-key";

void test("the assigned mission channel is an ordinary protected channel", async () => {
  const directory = mkdtempSync(join(tmpdir(), "chief-mission-control-"));
  try {
    const store = new LocalStore(join(directory, "chief.sqlite"));
    const channelStore = store.channelStore();
    const channel = (await channelStore.list("workspace-a")).find(
      (candidate) => candidate.slug === "mission-control",
    );
    assert.ok(channel);
    assert.equal(channel.kind, "standard");
    assert.deepEqual(channel.agentIds, ["chief"]);
    assert.deepEqual(channel.agentPermissions, [
      "manage_members",
      "update_metadata",
    ]);
    await assert.rejects(
      channelStore.setArchived("workspace-a", channel.id, true, {
        actor: { type: "user", id: "workspace", name: "Workspace" },
      }),
      /assigned in Missions settings/u,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
