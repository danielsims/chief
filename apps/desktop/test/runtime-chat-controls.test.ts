import assert from "node:assert/strict";
import test from "node:test";

import {
  emptyChatControls,
  reduceChatControls,
  replayChatControls,
} from "../src/lib/runtime-chat-controls.js";

void test("a live runtime failure introduces an unread error", () => {
  const controls = reduceChatControls(emptyChatControls, {
    type: "error",
    message: "The agent stopped.",
  });

  assert.deepEqual(controls.error, { message: "The agent stopped." });
  assert.equal(controls.errorAcknowledged, false);
});

void test("history replay retains diagnostics without restoring the alert", () => {
  const controls = replayChatControls(
    [{ type: "error", message: "The agent stopped." }],
    false,
  );

  assert.deepEqual(controls.error, { message: "The agent stopped." });
  assert.equal(controls.errorAcknowledged, true);
});
