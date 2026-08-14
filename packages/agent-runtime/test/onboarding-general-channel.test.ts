import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { LocalStore } from "../src/local-store.js";
import { SessionManager } from "../src/manager.js";
import {
  ensureOnboardingGeneralChannel,
  inviteOwnerToMissionControl,
} from "../src/onboarding-general-channel.js";

process.env.CHIEF_DATABASE_ENCRYPTION_KEY =
  "chief-onboarding-general-channel-test-key";

void test("General includes the owner without onboarding messages", async () => {
  const directory = mkdtempSync(join(tmpdir(), "chief-general-invite-"));
  try {
    const store = new LocalStore(join(directory, "chief.sqlite"));
    const manager = new SessionManager(store);
    let channelUpdates = 0;
    const input = {
      manager,
      workspaceId: "workspace-a",
      onChannelsChanged: () => {
        channelUpdates += 1;
      },
    };

    await ensureOnboardingGeneralChannel(input);
    await ensureOnboardingGeneralChannel(input);

    const general = (await store.channelStore().list("workspace-a")).find(
      (channel) => channel.slug === "general",
    );
    assert.ok(general);
    assert.deepEqual(general.userIds, ["workspace-owner"]);
    assert.equal(channelUpdates, 0);
    const events = await store.channelStore().events("workspace-a", general.id);
    assert.deepEqual(events, []);
    await store.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

void test("Chief invites the owner to Mission Control once", async () => {
  const directory = mkdtempSync(join(tmpdir(), "chief-mission-invite-"));
  try {
    const store = new LocalStore(join(directory, "chief.sqlite"));
    const manager = new SessionManager(store);
    let channelUpdates = 0;
    const input = {
      manager,
      workspaceId: "workspace-mission",
      channelId: "ce83fa02-5d8d-4fc1-9e31-f670676b0741",
      onChannelsChanged: () => {
        channelUpdates += 1;
      },
    };

    await inviteOwnerToMissionControl(input);
    await inviteOwnerToMissionControl(input);

    const mission = await store
      .channelStore()
      .get("workspace-mission", input.channelId);
    assert.ok(mission);
    assert.deepEqual(mission.userIds, ["workspace-owner"]);
    assert.equal(channelUpdates, 1);
    const events = await store
      .channelStore()
      .events("workspace-mission", mission.id);
    assert.equal(events.length, 1);
    const invite = events[0];
    assert.ok(invite);
    assert.equal(invite.content, "Chief added you to the channel.");
    assert.ok(
      invite.tags.some(
        (tag) => tag[0] === "action" && tag[1] === "member-added",
      ),
    );
    assert.ok(
      invite.tags.some(
        (tag) => tag[0] === "user" && tag[1] === "workspace-owner",
      ),
    );
    await store.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
