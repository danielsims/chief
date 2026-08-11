import assert from "node:assert/strict";
import test from "node:test";

import {
  applyOptimisticChannelReaction,
  foldChannelReactions,
} from "../src/lib/channel-reactions";

void test("channel reactions resolve protocol targets to chat message ids", () => {
  const reactions = foldChannelReactions([
    {
      protocol: "nip29",
      id: "event-1",
      channelId: "channel-1",
      kind: 9,
      pubkey: "agent-key",
      tags: [
        ["h", "channel-1"],
        ["client", "message-1"],
      ],
      content: "Ready",
      actor: { type: "agent", id: "chief", name: "Chief" },
      createdAt: 1,
    },
    {
      protocol: "nip29",
      id: "reaction-1",
      channelId: "channel-1",
      kind: 7,
      pubkey: "user-key",
      tags: [
        ["h", "channel-1"],
        ["e", "event-1", "", "reply"],
      ],
      content: "👍",
      actor: { type: "user", id: "workspace-owner", name: "You" },
      createdAt: 2,
    },
  ]);

  assert.deepEqual(reactions.get("message-1"), [
    { emoji: "👍", count: 1, reacted: true, names: ["You"] },
  ]);
});

void test("optimistic channel reactions add and remove immediate feedback", () => {
  const added = applyOptimisticChannelReaction(
    new Map(),
    "message-1",
    "❤️",
    true,
  );
  assert.deepEqual(added.get("message-1"), [
    { emoji: "❤️", count: 1, reacted: true, names: ["You"] },
  ]);

  const removed = applyOptimisticChannelReaction(
    added,
    "message-1",
    "❤️",
    false,
  );
  assert.equal(removed.has("message-1"), false);
});
