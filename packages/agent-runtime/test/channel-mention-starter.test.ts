import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { ChannelEvent } from "../src/channel-types.js";
import {
  channelMentionThreadRoot,
  ensureOnboardingHomeChannel,
  isOnboardingMention,
} from "../src/channel-mention-starter.js";
import { LocalStore } from "../src/local-store.js";
import { SessionManager } from "../src/manager.js";

process.env.CHIEF_DATABASE_ENCRYPTION_KEY =
  "chief-channel-mention-starter-test-key";

function message(tags: string[][]): ChannelEvent {
  return {
    protocol: "nip29",
    id: "event",
    channelId: "mission-control",
    kind: 9,
    pubkey: "chief",
    tags,
    content: "@Marketer, research our brand.",
    actor: { type: "agent", id: "chief", name: "Chief" },
    createdAt: Date.now(),
  };
}

void test("onboarding mention keys preserve initial specialist semantics", () => {
  assert.equal(
    isOnboardingMention(
      message([["client", "channel-api:onboarding-brand-thread"]]),
    ),
    true,
  );
  assert.equal(
    isOnboardingMention(
      message([["client", "channel-api:feature-brand-review"]]),
    ),
    false,
  );
});

void test("mentioned work owns the stable client thread root", () => {
  assert.equal(
    channelMentionThreadRoot(
      message([["client", "channel-api:onboarding-brand-thread"]]),
    ),
    "channel-api:onboarding-brand-thread",
  );
  assert.equal(channelMentionThreadRoot(message([])), "event");
});

void test("onboarding creates one private Setup channel with full membership", async () => {
  const directory = mkdtempSync(join(tmpdir(), "chief-setup-channel-"));
  try {
    const store = new LocalStore(join(directory, "chief.sqlite"));
    const manager = new SessionManager(store);
    let channelUpdates = 0;
    const input = {
      manager,
      workspaceId: "workspace-setup",
      agentId: "setup",
      onChannelsChanged: () => {
        channelUpdates += 1;
      },
    };

    const first = await ensureOnboardingHomeChannel(input);
    const second = await ensureOnboardingHomeChannel(input);

    assert.ok(first);
    assert.equal(second?.id, first.id);
    assert.equal(first.slug, "setup");
    assert.equal(first.visibility, "private");
    assert.deepEqual(first.agentIds, ["setup", "chief"]);
    assert.deepEqual(first.userIds, ["workspace-owner"]);
    assert.deepEqual(first.agentPermissions, [
      "update_metadata",
      "manage_members",
      "manage_workstream",
      "archive",
    ]);
    assert.equal(channelUpdates, 1);
    await store.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

void test("onboarding repairs a public Setup channel before authentication", async () => {
  const directory = mkdtempSync(join(tmpdir(), "chief-setup-channel-repair-"));
  try {
    const store = new LocalStore(join(directory, "chief.sqlite"));
    const manager = new SessionManager(store);
    const publicSetup = await store.channelStore().create("workspace-setup", {
      name: "setup",
      visibility: "public",
      actor: { type: "agent", id: "chief", name: "Chief" },
      agentIds: ["chief", "setup", "analyst"],
      userIds: ["workspace-owner", "workspace-guest"],
    });

    const repaired = await ensureOnboardingHomeChannel({
      manager,
      workspaceId: "workspace-setup",
      agentId: "setup",
    });

    assert.ok(repaired);
    assert.equal(repaired.id, publicSetup.id);
    assert.equal(repaired.visibility, "private");
    assert.deepEqual(repaired.agentIds, ["setup", "chief"]);
    assert.deepEqual(repaired.userIds, ["workspace-owner"]);
    await store.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

void test("Engineering stays hidden until Engineer invites the owner", async () => {
  const directory = mkdtempSync(join(tmpdir(), "chief-engineering-channel-"));
  try {
    const store = new LocalStore(join(directory, "chief.sqlite"));
    const manager = new SessionManager(store);

    const engineering = await ensureOnboardingHomeChannel({
      manager,
      workspaceId: "workspace-engineering",
      agentId: "engineer",
    });

    assert.ok(engineering);
    assert.equal(engineering.slug, "engineering");
    assert.deepEqual(engineering.agentIds, ["chief", "engineer"]);
    assert.deepEqual(engineering.userIds, []);
    await store.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
