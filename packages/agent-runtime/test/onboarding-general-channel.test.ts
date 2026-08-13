import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { LocalStore } from "../src/local-store.js";
import { SessionManager } from "../src/manager.js";
import {
  ensureOnboardingEngineeringChannel,
  ensureOnboardingGeneralChannel,
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

void test("Engineering is visible and staffed after onboarding", async () => {
  const directory = mkdtempSync(join(tmpdir(), "chief-engineering-invite-"));
  try {
    const store = new LocalStore(join(directory, "chief.sqlite"));
    const manager = new SessionManager(store);
    let channelUpdates = 0;
    const input = {
      manager,
      workspaceId: "workspace-engineering",
      onChannelsChanged: () => {
        channelUpdates += 1;
      },
    };

    await ensureOnboardingEngineeringChannel(input);
    await ensureOnboardingEngineeringChannel(input);

    const engineering = (
      await store.channelStore().list("workspace-engineering")
    ).find((channel) => channel.slug === "engineering");
    assert.ok(engineering);
    assert.deepEqual(engineering.agentIds, ["chief", "engineer"]);
    assert.deepEqual(engineering.userIds, ["workspace-owner"]);
    assert.equal(channelUpdates, 0);
    await store.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
