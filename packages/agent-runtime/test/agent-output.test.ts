import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeAgentText,
  normalizeAssistantEvent,
} from "../src/agent-output.js";

void test("removes em dashes from every user-facing agent message", () => {
  assert.equal(
    normalizeAgentText("That fits nicely — dropping the cards below."),
    "That fits nicely, dropping the cards below.",
  );
  assert.equal(
    normalizeAgentText("The scan is done. — Nothing changed."),
    "The scan is done. Nothing changed.",
  );
  assert.deepEqual(
    normalizeAssistantEvent({
      type: "message",
      role: "assistant",
      content: [{ type: "text", text: "Vercel — ready." }],
    }),
    {
      type: "message",
      role: "assistant",
      content: [{ type: "text", text: "Vercel, ready." }],
    },
  );
});
