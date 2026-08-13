import assert from "node:assert/strict";
import test from "node:test";

import type { ChannelEvent } from "@chief/agent-runtime/types";

import { channelInboxMessages } from "../src/lib/channel-inbox";
import {
  advanceReadContext,
  channelContextKey,
  mergeObservedMessageSnapshot,
  observedChannelMessage,
  parseChannelReadState,
  threadContextKey,
  unreadCountsByChannel,
} from "../src/lib/channel-read-state";

function message(input: {
  id: string;
  createdAt: number;
  rootId?: string;
  actorId?: string;
}): ChannelEvent {
  return {
    protocol: "nip29",
    id: input.id,
    channelId: "analytics",
    pubkey: "pubkey",
    tags: input.rootId
      ? [
          ["e", input.rootId, "", "root"],
          ["e", input.rootId, "", "reply"],
        ]
      : [],
    content: "Hello",
    actor:
      input.actorId === "workspace-owner"
        ? { type: "user", id: input.actorId, name: "Daniel" }
        : { type: "agent", id: input.actorId ?? "chief", name: "Chief" },
    kind: 9,
    createdAt: input.createdAt,
  };
}

void test("channel and thread frontiers independently clear unread messages", () => {
  const topLevel = observedChannelMessage(
    message({ id: "top", createdAt: 100 }),
  );
  const reply = observedChannelMessage(
    message({ id: "reply", createdAt: 200, rootId: "top" }),
  );
  assert.ok(topLevel);
  assert.ok(reply);

  let state = parseChannelReadState(null);
  assert.deepEqual(
    [...unreadCountsByChannel(state, [topLevel, reply])],
    [["analytics", 2]],
  );

  state = advanceReadContext(state, channelContextKey("analytics"), 100);
  assert.deepEqual(
    [...unreadCountsByChannel(state, [topLevel, reply])],
    [["analytics", 1]],
  );

  state = advanceReadContext(state, threadContextKey("analytics", "top"), 200);
  assert.deepEqual([...unreadCountsByChannel(state, [topLevel, reply])], []);
});

void test("read frontiers are monotonic and ignore malformed persisted values", () => {
  const state = parseChannelReadState({
    v: 1,
    contexts: { good: 12, bad: "yesterday", negative: -1 },
  });
  assert.deepEqual(state.contexts, { good: 12 });
  const advanced = advanceReadContext(state, "good", 10);
  assert.equal(advanced, state);
});

void test("own messages and reactions never become unread activity", () => {
  assert.equal(
    observedChannelMessage(
      message({ id: "mine", createdAt: 1, actorId: "workspace-owner" }),
    ),
    null,
  );
  assert.equal(
    observedChannelMessage({
      ...message({ id: "reaction", createdAt: 2 }),
      kind: 7,
      content: "👀",
    }),
    null,
  );
});

void test("a stale history snapshot cannot erase a newer live message", () => {
  const live = {
    id: "live",
    channelId: "general",
    createdAt: 200,
    rootId: null,
    sourceId: "live",
    threadSourceId: null,
    content: "Hello",
    actor: { type: "agent" as const, id: "chief", name: "Chief" },
  };
  assert.deepEqual(
    [
      ...mergeObservedMessageSnapshot(
        new Map(),
        new Map([[live.id, live]]),
        new Set([live.id]),
      ),
    ],
    [[live.id, live]],
  );
});

void test("the inbox keeps recent messages ordered and preserves unread state", () => {
  const older = observedChannelMessage(
    message({ id: "older", createdAt: 100 }),
  );
  const newer = observedChannelMessage(
    message({ id: "newer", createdAt: 200 }),
  );
  assert.ok(older);
  assert.ok(newer);
  const readState = advanceReadContext(
    parseChannelReadState(null),
    channelContextKey("analytics"),
    100,
  );

  assert.deepEqual(
    channelInboxMessages(
      readState,
      new Map([
        [
          "analytics",
          new Map([
            [older.id, older],
            [newer.id, newer],
          ]),
        ],
      ]),
    ).map((entry) => ({ id: entry.id, unread: entry.unread })),
    [
      { id: "newer", unread: true },
      { id: "older", unread: false },
    ],
  );
});

void test("an agent adding the owner is notification-worthy channel activity", () => {
  const invite = observedChannelMessage({
    ...message({ id: "invite", createdAt: 300, actorId: "engineer" }),
    tags: [
      ["action", "member-added"],
      ["user", "workspace-owner"],
    ],
    content: "Engineer added you to the channel.",
  });
  assert.ok(invite);
  assert.deepEqual(
    [...unreadCountsByChannel(parseChannelReadState(null), [invite])],
    [["analytics", 1]],
  );
});
