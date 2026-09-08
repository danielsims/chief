import assert from "node:assert/strict";
import test from "node:test";

import {
  hasTextualMention,
  messageMentionsPerson,
  normalizedChannelMentions,
} from "../src/channel-message-mentions.js";

void test("matches a multi-word person name inside markdown and punctuation", () => {
  const content = "**Hey @Daniel Sims, first brand profile is done**";
  assert.equal(hasTextualMention(content, "Daniel Sims"), true);
  assert.equal(
    messageMentionsPerson({
      content,
      mentions: [],
      person: { id: "user-daniel", name: "Daniel Sims" },
    }),
    true,
  );
});

void test("promotes a visible person mention into durable mention ids", () => {
  assert.deepEqual(
    normalizedChannelMentions({
      availableAgentIds: ["brand"],
      people: [{ id: "user-daniel", name: "Daniel Sims" }],
      content: "Hey @Daniel Sims, first brand profile is done",
      explicitMentions: [],
    }),
    ["user-daniel"],
  );
});

void test("keeps an explicit person id even when the visible name is missing", () => {
  assert.equal(
    messageMentionsPerson({
      content: "Flagging this for you.",
      mentions: ["user-daniel"],
      person: { id: "user-daniel", name: "Daniel Sims" },
    }),
    true,
  );
});
