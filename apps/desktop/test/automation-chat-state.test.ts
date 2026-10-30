import assert from "node:assert/strict";
import { test } from "node:test";

import { conversationMessageSchema } from "@chief/relay-contracts";

import { automationChatState } from "../src/pages/automation-chat-state.ts";

const message = (
  sequence: number,
  body: string,
  kind = "user",
  component?: { kind: string; payload: Record<string, string> },
) =>
  conversationMessageSchema.parse({
    id: `message-${sequence}`,
    workspaceId: "workspace-a",
    conversationId: "automation-chat-a",
    author: { kind, id: kind === "user" ? "person" : "chief" },
    body,
    sequence,
    createdAt: "2026-10-29T04:47:00Z",
    components: component
      ? [{ id: `component-${sequence}`, version: 1, ...component }]
      : [],
  });
const user = message(1, "Build this automation");
const activity = (status: string) =>
  message(2, "", "agent", { kind: "agent.activity", payload: { status } });
void test("a sent request stays working before activity and through intermediate replies", () => {
  assert.equal(automationChatState([user]).working, true);
  assert.equal(
    automationChatState([
      user,
      activity("working"),
      message(3, "I will build it", "agent"),
    ]).working,
    true,
  );
  assert.equal(
    automationChatState([
      user,
      activity("completed"),
      message(3, "Built it", "agent"),
    ]).working,
    false,
  );
});
void test("a model failure is visible and stops the matrix even without an assistant reply", () => {
  const error = message(3, "", "agent", {
    kind: "error",
    payload: { message: "Model is unavailable.", title: "Agent run failed" },
  });
  const state = automationChatState([user, activity("failed"), error]);
  assert.equal(state.working, false);
  assert.equal(state.error?.message, "Model is unavailable.");
  const retry = message(4, "Try again");
  assert.deepEqual(
    automationChatState([user, activity("failed"), error, retry]),
    { working: true, error: undefined },
  );
});
