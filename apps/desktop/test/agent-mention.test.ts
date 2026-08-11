import assert from "node:assert/strict";
import test from "node:test";

import {
  removeAgentMentionBeforeCaret,
  splitAgentMentions,
} from "../src/components/chat/agent-mention-parser.js";

void test("splits known Chief agent mentions into semantic inline tokens", () => {
  assert.deepEqual(
    splitAgentMentions("Can @Analyst review this with @Brand?"),
    [
      { type: "text", value: "Can " },
      { type: "mention", agentId: "analyst", label: "Analyst" },
      { type: "text", value: " review this with " },
      { type: "mention", agentId: "brand", label: "Marketer" },
      { type: "text", value: "?" },
    ],
  );
});

void test("normalizes lowercase agent ids to display names", () => {
  assert.deepEqual(splitAgentMentions("@brand and @prospector"), [
    { type: "mention", agentId: "brand", label: "Marketer" },
    { type: "text", value: " and " },
    { type: "mention", agentId: "prospector", label: "Prospector" },
  ]);
});

void test("does not style email addresses or partial agent names", () => {
  assert.deepEqual(splitAgentMentions("mail@Analyst.io and @Branding"), [
    { type: "text", value: "mail@Analyst.io and @Branding" },
  ]);
});

void test("one backspace removes a complete composer mention chip", () => {
  assert.deepEqual(removeAgentMentionBeforeCaret("Ask @Analyst ", 13, 13), {
    value: "Ask ",
    selectionStart: 4,
    selectionEnd: 4,
  });
  assert.deepEqual(removeAgentMentionBeforeCaret("Ask @Analyst next", 12, 12), {
    value: "Ask next",
    selectionStart: 4,
    selectionEnd: 4,
  });
});

void test("backspace remains native inside mention text or a selection", () => {
  assert.equal(removeAgentMentionBeforeCaret("Ask @Analyst ", 8, 8), undefined);
  assert.equal(
    removeAgentMentionBeforeCaret("Ask @Analyst ", 4, 12),
    undefined,
  );
});
