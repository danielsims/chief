import assert from "node:assert/strict";
import test from "node:test";

import {
  controlsForConversation,
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

void test("intentional stops do not create alerts but process failures still do", () => {
  for (const message of ["turn interrupted", " Turn cancelled "]) {
    const controls = reduceChatControls(
      { ...emptyChatControls, status: "running" },
      { type: "error", message },
    );
    assert.equal(controls.status, "idle");
    assert.equal(controls.error, undefined);
  }
  const failure = reduceChatControls(emptyChatControls, {
    type: "error",
    message: "Agent process exited with code 1.",
  });
  assert.ok(failure.error);
  assert.equal(failure.errorAcknowledged, false);
});

void test("history replay retains diagnostics without restoring the alert", () => {
  const controls = replayChatControls(
    [{ type: "error", message: "The agent stopped." }],
    false,
  );

  assert.deepEqual(controls.error, { message: "The agent stopped." });
  assert.equal(controls.errorAcknowledged, true);
});

void test("a channel switch does not expose the previous conversation error", () => {
  const previousControls = reduceChatControls(emptyChatControls, {
    type: "error",
    message: "The previous agent stopped.",
  });

  assert.equal(
    controlsForConversation(
      previousControls,
      "workspace:channel-a",
      "workspace:channel-b",
    ).error,
    undefined,
  );
  assert.equal(
    controlsForConversation(
      previousControls,
      "workspace:channel-a",
      "workspace:channel-a",
    ).error?.message,
    "The previous agent stopped.",
  );
});
