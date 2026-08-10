import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { LocalStore } from "../src/local-store.js";

process.env.CHIEF_DATABASE_ENCRYPTION_KEY =
  "chief-channel-management-integration-test-key";

void test("feature channel retries, lifecycle, and audit history stay durable", async () => {
  const directory = mkdtempSync(join(tmpdir(), "chief-channel-management-"));
  try {
    const store = new LocalStore(join(directory, "chief.sqlite"));
    const actor = {
      type: "agent" as const,
      id: "engineer",
      name: "Engineer",
    };
    const created = await store.channelStore().create("workspace-a", {
      name: "Feature sharing",
      kind: "feature",
      actor,
      agentIds: ["engineer"],
      agentPermissions: ["update_metadata", "archive"],
      operationKey: "feature-sharing-channel",
      strictName: true,
      workstream: { status: "active", pullRequestUrls: [] },
    });
    const retried = await store.channelStore().create("workspace-a", {
      name: "Feature sharing",
      operationKey: "feature-sharing-channel",
      strictName: true,
    });
    assert.equal(retried.id, created.id);

    const archived = await store
      .channelStore()
      .setArchived("workspace-a", created.id, true, {
        expectedVersion: 1,
        actor,
      });
    assert.equal(archived.lifecycle, "archived");
    assert.ok(archived.archivedAt);
    assert.equal(archived.version, 2);
    assert.deepEqual(
      (await store.channelStore().activity("workspace-a", created.id)).map(
        (entry) => entry.action,
      ),
      ["channel.created", "channel.archived"],
    );
    await store.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

void test("concurrent archives cannot remove the final active public channel", async () => {
  const directory = mkdtempSync(join(tmpdir(), "chief-channel-archive-race-"));
  const store = new LocalStore(join(directory, "chief.sqlite"));
  const actor = {
    type: "agent" as const,
    id: "engineer",
    name: "Engineer",
  };
  try {
    const initial = (await store.channelStore().list("workspace-a")).filter(
      (channel) =>
        channel.visibility === "public" && channel.lifecycle === "active",
    );
    assert.ok(initial.length >= 2);
    for (const channel of initial.slice(2)) {
      await store.channelStore().setArchived("workspace-a", channel.id, true, {
        expectedVersion: channel.version,
        actor,
      });
    }

    const candidates = (await store.channelStore().list("workspace-a")).filter(
      (channel) =>
        channel.visibility === "public" && channel.lifecycle === "active",
    );
    assert.equal(candidates.length, 2);
    const outcomes = await Promise.allSettled(
      candidates.map((channel) =>
        store.channelStore().setArchived("workspace-a", channel.id, true, {
          expectedVersion: channel.version,
          actor,
        }),
      ),
    );
    assert.equal(
      outcomes.filter((outcome) => outcome.status === "fulfilled").length,
      1,
    );
    assert.equal(
      outcomes.filter((outcome) => outcome.status === "rejected").length,
      1,
    );
    assert.equal(
      (await store.channelStore().list("workspace-a")).filter(
        (channel) =>
          channel.visibility === "public" && channel.lifecycle === "active",
      ).length,
      1,
    );
  } finally {
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
