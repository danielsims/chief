import assert from "node:assert/strict";
import test from "node:test";

import type { ChannelEvent } from "@chief/agent-runtime/types";

import {
  newSnapshotNotificationMessages,
  workspaceNotificationStartedAt,
} from "../src/lib/channel-read-state-storage";
import {
  notificationSoundIsOutsideBurst,
  parseNotificationSoundPreferences,
  shouldPlayChannelNotification,
} from "../src/lib/notification-sounds";

function message(actor: ChannelEvent["actor"]): ChannelEvent {
  return {
    protocol: "nip29",
    id: `${actor.type}-${actor.id}`,
    channelId: "general",
    pubkey: "pubkey",
    tags: [],
    content: "Hello",
    actor,
    kind: 9,
    createdAt: 1,
  };
}

void test("repairs invalid notification preferences with quiet defaults", () => {
  assert.deepEqual(parseNotificationSoundPreferences(null), {
    desktopEnabled: true,
    enabled: true,
    sound: "chime",
  });
  assert.deepEqual(
    parseNotificationSoundPreferences({ enabled: false, sound: "sparkle" }),
    { desktopEnabled: true, enabled: false, sound: "sparkle" },
  );
  assert.deepEqual(
    parseNotificationSoundPreferences({ enabled: "yes", sound: "airhorn" }),
    { desktopEnabled: true, enabled: true, sound: "chime" },
  );
});

void test("notifies for agents and other people but not the workspace owner", () => {
  assert.equal(
    shouldPlayChannelNotification(
      message({ type: "agent", id: "analyst", name: "Analyst" }),
    ),
    true,
  );
  assert.equal(
    shouldPlayChannelNotification(
      message({ type: "user", id: "teammate", name: "Ash" }),
    ),
    true,
  );
  assert.equal(
    shouldPlayChannelNotification(
      message({ type: "user", id: "workspace-owner", name: "Daniel Sims" }),
    ),
    false,
  );
});

void test("reaction events never create notification sounds", () => {
  const reaction: ChannelEvent = {
    ...message({ type: "agent", id: "chief", name: "Chief" }),
    kind: 7,
    content: "👀",
  };
  assert.equal(shouldPlayChannelNotification(reaction), false);
});

void test("coalesces only sounds dispatched in the same 100ms burst", () => {
  assert.equal(notificationSoundIsOutsideBurst(1_000, 1_050), false);
  assert.equal(notificationSoundIsOutsideBurst(1_000, 1_099), false);
  assert.equal(notificationSoundIsOutsideBurst(1_000, 1_100), true);
});

void test("recovers notifications for messages missed during channel subscription", () => {
  const oldMessage = {
    id: "old",
    channelId: "general",
    createdAt: 99,
    rootId: null,
    sourceId: null,
    threadSourceId: null,
    content: "Already here",
    mentionIds: [],
    actor: { type: "agent" as const, id: "chief", name: "Chief" },
  };
  const recoveredMessage = {
    ...oldMessage,
    id: "recovered",
    createdAt: 101,
    content: "Finished setup",
  };
  const alreadyNotified = {
    ...recoveredMessage,
    id: "live",
    createdAt: 102,
  };

  assert.deepEqual(
    newSnapshotNotificationMessages(
      [oldMessage, recoveredMessage, alreadyNotified],
      100,
      new Set(["live"]),
    ).map((entry) => entry.id),
    ["recovered"],
  );
});

void test("workspace onboarding messages remain eligible when the observer mounts later", () => {
  assert.equal(workspaceNotificationStartedAt(200, "100"), 100);
  assert.equal(workspaceNotificationStartedAt(200, null), 200);
});
