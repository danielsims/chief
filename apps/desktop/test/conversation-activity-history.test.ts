import assert from "node:assert/strict";
import test from "node:test";

import { conversationActivityTurns } from "../src/components/chat/conversation-activity-history.ts";

void test("activity history groups tool calls under the user turn that triggered them", () => {
  const turns = conversationActivityTurns([
    {
      id: "user-1",
      role: "user",
      createdAt: 10,
      blocks: [{ type: "text", text: "Audit the repository" }],
    },
    {
      id: "assistant-1",
      role: "assistant",
      createdAt: 11,
      blocks: [
        { type: "text", text: "I’ll check it now." },
        { type: "tool_use", id: "tool-1", name: "read", input: {} },
      ],
    },
    {
      id: "assistant-2",
      role: "assistant",
      createdAt: 12,
      blocks: [{ type: "tool_result", tool_use_id: "tool-1", content: "done" }],
    },
    {
      id: "user-2",
      role: "user",
      createdAt: 20,
      blocks: [{ type: "text", text: "Run the checks" }],
    },
    {
      id: "assistant-3",
      role: "assistant",
      createdAt: 21,
      blocks: [{ type: "tool_use", id: "tool-2", name: "bash", input: {} }],
    },
  ]);

  assert.deepEqual(
    turns.map((turn) => ({
      id: turn.id,
      prompt: turn.prompt,
      blockTypes: turn.blocks.map((block) => block.type),
    })),
    [
      {
        id: "user-1",
        prompt: "Audit the repository",
        blockTypes: ["tool_use", "tool_result"],
      },
      {
        id: "user-2",
        prompt: "Run the checks",
        blockTypes: ["tool_use"],
      },
    ],
  );
});

void test("activity labels omit private setup markers", () => {
  const [turn] = conversationActivityTurns([
    {
      id: "setup-turn",
      role: "user",
      blocks: [
        {
          type: "text",
          text: "[chief-integration-setup:attempt]\n[chief-skill:setup-github]\nConnect GitHub to the repository.",
        },
      ],
    },
    {
      id: "setup-tool",
      role: "assistant",
      blocks: [{ type: "tool_use", id: "tool", name: "setup", input: {} }],
    },
  ]);

  assert.equal(turn?.prompt, "Connect GitHub to the repository.");
});
