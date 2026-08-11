import assert from "node:assert/strict";
import test from "node:test";

import {
  channelTimeline,
  messageById,
  threadMessages,
} from "../src/channels/message-projection.js";
import { createChannelEvent } from "../src/channels/nip29.js";

const actor = { type: "agent" as const, id: "chief", name: "Chief" };

void test("legacy client-ID replies resolve to their durable thread root", () => {
  const root = createChannelEvent({
    workspaceId: "workspace",
    channelId: "engineering",
    actor,
    content: "What changed?",
    sourceId: "client-root",
  });
  const reply = createChannelEvent({
    workspaceId: "workspace",
    channelId: "engineering",
    actor,
    content: "The work is complete.",
    threadRootId: "client-root",
    sourceId: "client-reply",
  });
  const events = [root, reply];

  assert.equal(channelTimeline(events)[0]?.replyCount, 1);
  assert.equal(messageById(events, reply.id)?.threadRootId, root.id);
  assert.deepEqual(
    threadMessages(events, root.id).map((message) => message.id),
    [root.id, reply.id],
  );
  assert.deepEqual(
    threadMessages(events, "client-root").map((message) => message.id),
    [root.id, reply.id],
  );
});
