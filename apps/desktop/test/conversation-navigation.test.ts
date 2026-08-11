import assert from "node:assert/strict";
import test from "node:test";

import {
  withConversationChild,
  withConversationThread,
  withoutConversationChild,
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
