import assert from "node:assert/strict";
import test from "node:test";

import { isNewConversation } from "../src/pages/conversation-routing.js";

void test("an unresolved channel is not rendered as a new conversation", () => {
  assert.equal(
    isNewConversation("channel:workspace:setup", true, false, false),
    false,
  );
});

void test("a missing resolved direct chat can start as a new conversation", () => {
  assert.equal(isNewConversation("new-direct-chat", false, false, false), true);
});
