import assert from "node:assert/strict";
import test from "node:test";

import {
  removeAgentMentionBeforeCaret,
  splitAgentMentions,
} from "../src/components/chat/agent-mention-parser.js";

void test("splits known people mentions into semantic inline tokens", () => {
  assert.deepEqual(
    splitAgentMentions("Can @Workspace review this?", [
      { id: "workspace-owner", name: "Workspace" },
    ]),
    [
      { type: "text", value: "Can " },
      {
        type: "mention",
        agentId: "workspace-owner",
        label: "Workspace",
        token: "@Workspace",
      },
      { type: "text", value: " review this?" },
    ],
  );
});

void test("chips a spaced person name and its first name", () => {
  const people = [{ id: "workspace-owner", name: "Workspace Owner" }];
  assert.deepEqual(
    splitAgentMentions(
      "Hey @Workspace Owner, first brand profile is done",
      people,
    ),
    [
      { type: "text", value: "Hey " },
      {
        type: "mention",
        agentId: "workspace-owner",
        label: "Workspace Owner",
        token: "@Workspace Owner",
      },
      { type: "text", value: ", first brand profile is done" },
    ],
  );
  assert.deepEqual(splitAgentMentions("Ping @Workspace later", people), [
    { type: "text", value: "Ping " },
    {
      type: "mention",
      agentId: "workspace-owner",
      label: "Workspace Owner",
      token: "@Workspace",
    },
    { type: "text", value: " later" },
  ]);
});

void test("splits known Chief agent mentions into semantic inline tokens", () => {
  assert.deepEqual(
    splitAgentMentions("Can @Analyst review this with @Brand?"),
    [
      { type: "text", value: "Can " },
      {
        type: "mention",
        agentId: "analyst",
        label: "Analyst",
        token: "@Analyst",
      },
      { type: "text", value: " review this with " },
      { type: "mention", agentId: "brand", label: "Marketer", token: "@Brand" },
      { type: "text", value: "?" },
    ],
  );
});

void test("normalizes lowercase agent ids to display names", () => {
  assert.deepEqual(splitAgentMentions("@brand and @prospector"), [
    { type: "mention", agentId: "brand", label: "Marketer", token: "@brand" },
    { type: "text", value: " and " },
    {
      type: "mention",
      agentId: "prospector",
      label: "Prospector",
      token: "@prospector",
    },
  ]);
});

void test("keeps live multiword agent names whole for rendering and deletion", () => {
  const agents = [
    { id: "content", name: "Content Writer" },
    { id: "device-123", name: "On Device" },
  ];
  assert.deepEqual(
    splitAgentMentions("@Content Writer and @On Device", agents),
    [
      {
        type: "mention",
        agentId: "content",
        label: "Content Writer",
        token: "@Content Writer",
      },
      { type: "text", value: " and " },
      {
        type: "mention",
        agentId: "device-123",
        label: "On Device",
        token: "@On Device",
      },
    ],
  );
  assert.deepEqual(splitAgentMentions("@content", agents), [
    {
      type: "mention",
      agentId: "content",
      label: "Content Writer",
      token: "@content",
    },
  ]);
  const text = "Ask @Content Writer ";
  assert.deepEqual(
    removeAgentMentionBeforeCaret(text, text.length, text.length, agents),
    {
      value: "Ask ",
      selectionStart: 4,
      selectionEnd: 4,
    },
  );
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
