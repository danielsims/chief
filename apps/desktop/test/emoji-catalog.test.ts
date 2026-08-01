import assert from "node:assert/strict";
import test from "node:test";

import {
  emojiForShortcode,
  matchingEmoji,
} from "../src/components/chat/emoji-catalog.js";

void test("emoji shortcodes resolve exact completed names", () => {
  assert.equal(emojiForShortcode("heart")?.emoji, "❤️");
  assert.equal(emojiForShortcode("HEART")?.emoji, "❤️");
  assert.equal(emojiForShortcode("missing"), undefined);
});

void test("emoji autocomplete searches names and familiar keywords", () => {
  const heartMatches = matchingEmoji("hea").map((option) => option.shortcode);
  assert.equal(heartMatches[0], "heart");
  assert.ok(heartMatches.includes("heart_eyes"));
  assert.equal(matchingEmoji("rocket")[0]?.emoji, "🚀");
});
