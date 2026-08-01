import assert from "node:assert/strict";
import test from "node:test";

import type { LocalChatSummary } from "../src/lib/runtime";
import { classifyChannel } from "../src/lib/channel-sections";

function chat(title: string, lastText = ""): LocalChatSummary {
  return {
    id: title,
    agent: "chief",
    title,
    lastText,
    lastAt: 0,
    running: false,
  };
}

void test("classifies channel titles into product sections", () => {
  assert.equal(classifyChannel(chat("Google Analytics setup")), "analytics");
  assert.equal(classifyChannel(chat("Plan launch campaign")), "campaigns");
  assert.equal(classifyChannel(chat("Research new prospects")), "prospects");
});

void test("uses recent channel text and keeps unmatched work in general", () => {
  assert.equal(
    classifyChannel(chat("Weekly review", "Traffic performance is ready")),
    "analytics",
  );
  assert.equal(classifyChannel(chat("Set up a new integration")), "general");
});
