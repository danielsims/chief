import assert from "node:assert/strict";
import test from "node:test";

import type { ChannelEvent } from "../src/channel-types.js";
import {
  channelMentionThreadRoot,
  isOnboardingMention,
} from "../src/channel-mention-starter.js";

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
