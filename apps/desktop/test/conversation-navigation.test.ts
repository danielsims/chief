import assert from "node:assert/strict";
import test from "node:test";

import {
  withConversationChild,
  withConversationThread,
  withoutConversationChild,
  withOwnedConversationChild,
} from "../src/lib/conversation-navigation.js";

void test("closing nested agent work returns to its owning thread", () => {
  const thread = withConversationThread(
    new URLSearchParams("channel=engineering"),
    "thread-1",
  );
  const child = withConversationChild(
    thread,
    "subagent-1",
    "channel:workspace:engineering",
    "engineering",
  );
  const returned = withoutConversationChild(child, "thread-1");

  assert.equal(returned.get("thread"), "thread-1");
  assert.equal(returned.get("child"), null);
  assert.equal(returned.get("channel"), "engineering");
});

void test("closing nested work entirely clears child and thread", () => {
  const closed = withoutConversationChild(
    new URLSearchParams("channel=engineering&thread=thread-1&child=subagent-1"),
  );

  assert.equal(closed.get("thread"), null);
  assert.equal(closed.get("child"), null);
});

void test("opening a thread atomically replaces incompatible panels", () => {
  const opened = withConversationThread(
    new URLSearchParams(
      "channel=engineering&activity=1&child=subagent-1&profile=engineer",
    ),
    "thread-1",
  );

  assert.equal(opened.get("thread"), "thread-1");
  assert.equal(opened.get("activity"), null);
  assert.equal(opened.get("child"), null);
  assert.equal(opened.get("profile"), null);
  assert.equal(opened.get("channel"), "engineering");
});

void test("opening nested work in a DM does not inject a channel", () => {
  const child = withConversationChild(
    new URLSearchParams("dm=setup&thread=thread-2"),
    "subagent-2",
    "channel:workspace:dm-setup",
  );

  assert.equal(child.get("dm"), "setup");
  assert.equal(child.get("channel"), null);
  assert.equal(child.get("thread"), "thread-2");
});

void test("cross-channel nested work opens in its owning direct message", () => {
  const next = withOwnedConversationChild(
    new URLSearchParams("channel=mission-control&thread=origin"),
    {
      id: "setup-task",
      parentId: "channel:workspace:setup-dm",
      triggerContext: { threadRootId: "setup-root" },
    },
    [
      {
        id: "setup-dm",
        visibility: "direct",
        agentIds: ["setup"],
      },
    ],
  );
  assert.equal(next.get("dm"), "setup");
  assert.equal(next.get("channel"), null);
  assert.equal(next.get("thread"), "setup-root");
  assert.equal(next.get("child"), "setup-task");
});
