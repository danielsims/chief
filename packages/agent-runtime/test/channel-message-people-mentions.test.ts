import assert from "node:assert/strict";
import test from "node:test";

import {
  hasTextualMention,
  messageMentionsPerson,
  normalizedChannelMentions,
} from "../src/channel-message-mentions.js";

void test("matches a multi-word person name inside markdown and punctuation", () => {
  const content = "**Hey @Workspace Owner, first brand profile is done**";
  assert.equal(hasTextualMention(content, "Workspace Owner"), true);
  assert.equal(
    messageMentionsPerson({
      content,
      mentions: [],
      person: { id: "workspace-owner", name: "Workspace Owner" },
    }),
    true,
  );
});

void test("promotes a visible person mention into durable mention ids", () => {
  assert.deepEqual(
    normalizedChannelMentions({
      availableAgentIds: ["brand"],
      people: [{ id: "workspace-owner", name: "Workspace Owner" }],
      content: "Hey @Workspace Owner, first brand profile is done",
      explicitMentions: [],
    }),
    ["workspace-owner"],
  );
});

void test("keeps an explicit person id even when the visible name is missing", () => {
  assert.equal(
    messageMentionsPerson({
      content: "Flagging this for you.",
      mentions: ["workspace-owner"],
      person: { id: "workspace-owner", name: "Workspace Owner" },
    }),
    true,
  );
});
