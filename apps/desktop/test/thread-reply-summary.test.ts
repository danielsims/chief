import assert from "node:assert/strict";
import test from "node:test";

import type { ContentBlock } from "@chief/agent-runtime/types";

import {
  hasBrowserInteraction,
  hasVisibleThreadContent,
  summarizeThreadReplyCandidates,
} from "../src/components/chat/thread-reply-summary.js";

const browser = (name: string): ContentBlock => ({
  type: "tool_use",
  id: name,
  name,
  input: {},
});

void test("recognizes browser operations across provider tool naming", () => {
  assert.equal(hasBrowserInteraction([browser("browser.open")]), true);
  assert.equal(
    hasBrowserInteraction([browser("mcp__chief_local__browser_click")]),
    true,
  );
  assert.equal(hasBrowserInteraction([browser("browserSnapshot")]), true);
  assert.equal(hasBrowserInteraction([browser("web_search")]), false);
});

void test("browser operations contribute through the browser component only", () => {
  assert.equal(hasVisibleThreadContent([browser("browser.click")]), false);
  assert.equal(
    hasVisibleThreadContent([
      browser("browser.open"),
      { type: "text", text: "Opened Apple beside this thread." },
    ]),
    true,
  );
  assert.equal(hasVisibleThreadContent([{ type: "text", text: "  " }]), false);
});

void test("a browser run contributes one reply instead of every tool event", () => {
  const visibleText: ContentBlock[] = [
    { type: "text", text: "Opened Apple beside this thread." },
  ];
  const summary = summarizeThreadReplyCandidates([
    {
      role: "assistant",
      createdAt: 1,
      blocks: visibleText,
      visibleBlocks: visibleText,
    },
    ...Array.from({ length: 14 }, (_, index) => ({
      role: "assistant" as const,
      createdAt: index + 2,
      blocks: [browser(index % 2 ? "browser.snapshot" : "browser.click")],
      visibleBlocks: [],
    })),
    {
      role: "user",
      createdAt: 20,
      blocks: [{ type: "text" as const, text: "Thanks" }],
      visibleBlocks: [{ type: "text" as const, text: "Thanks" }],
    },
  ]);

  assert.equal(summary.count, 3);
  assert.deepEqual(summary.visibleIndexes, [0, 15]);
  assert.equal(summary.lastReplyAt, 20);
});
