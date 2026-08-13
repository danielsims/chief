import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { defaultWorkspaceChannels } from "../src/channels/nip29.js";
import { LocalStore } from "../src/local-store.js";

process.env.CHIEF_DATABASE_ENCRYPTION_KEY =
  "chief-default-channel-permission-test-key";

void test("default public channels let member agents maintain metadata", () => {
  const channels = defaultWorkspaceChannels();
  for (const channel of channels.filter(
    (candidate) => candidate.visibility !== "direct",
  )) {
    assert.ok(channel.agentPermissions.includes("update_metadata"));
  }
});

void test("a fresh workspace starts the owner in mission control and General", () => {
  const joined = defaultWorkspaceChannels()
    .filter((channel) => channel.visibility !== "direct")
    .filter((channel) => channel.userIds.includes("workspace-owner"));

  assert.deepEqual(
    joined.map((channel) => channel.slug),
    ["mission-control", "general"],
  );
});

void test("an owner lock is not replaced by default channel policy", async () => {
  const directory = mkdtempSync(join(tmpdir(), "chief-channel-policy-"));
  const path = join(directory, "chief.sqlite");
  try {
    const first = new LocalStore(path);
    const channel = (await first.channelStore().list("workspace")).find(
      (candidate) => candidate.slug === "prospecting",
    );
    assert.ok(channel);
    await first.channelStore().setPolicy("workspace", channel.id, [], {
      type: "user",
      id: "workspace-owner",
      name: "Workspace owner",
    });
    await first.close();

    const reopened = new LocalStore(path);
    const locked = await reopened.channelStore().get("workspace", channel.id);
    assert.deepEqual(locked?.agentPermissions, []);
    await reopened.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
