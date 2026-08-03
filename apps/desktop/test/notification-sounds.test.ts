import assert from "node:assert/strict";
import test from "node:test";

import type { ChannelEvent } from "@chief/agent-runtime/types";

import {
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
