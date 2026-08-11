import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { ChannelEvent } from "../src/channel-types.js";
import { LocalStore } from "../src/local-store.js";
import { SessionManager } from "../src/manager.js";
import { ensureOnboardingGeneralChannel } from "../src/onboarding-general-channel.js";

process.env.CHIEF_DATABASE_ENCRYPTION_KEY =
  "chief-onboarding-general-channel-test-key";

void test("Chief invites the owner into General exactly once", async () => {
  const directory = mkdtempSync(join(tmpdir(), "chief-general-invite-"));
  try {
    const store = new LocalStore(join(directory, "chief.sqlite"));
    const manager = new SessionManager(store);
    const broadcasts: ChannelEvent[] = [];
    let channelUpdates = 0;
    const input = {
      manager,
      workspaceId: "workspace-a",
      broadcast: (event: ChannelEvent) => {
        broadcasts.push(event);
      },
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
    assert.equal(channelUpdates, 1);
    assert.equal(broadcasts.length, 2);
    const events = await store.channelStore().events("workspace-a", general.id);
    assert.deepEqual(
      new Set(events.map((event) => event.content)),
      new Set([
        "Chief added you to the channel.",
        "Welcome to #general. Drop anything here that needs a home, and I’ll pull in the right people when it turns into real work.",
      ]),
    );
    await store.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
