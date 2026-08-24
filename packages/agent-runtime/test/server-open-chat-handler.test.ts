import assert from "node:assert/strict";
import test from "node:test";

import type { LiveSessionState } from "../src/server-open-chat-handler.js";
import type { AgentEvent } from "../src/types.js";
import {
  shouldRecoverOnboardingOnOpen,
  shouldReuseLiveSessionOnOpen,
} from "../src/server-open-chat-handler.js";

function session(
  executionOwner: LiveSessionState["config"]["executionOwner"],
  isBusy: boolean,
) {
  return {
    config: { executionOwner },
    isBusy,
  } satisfies LiveSessionState;
}

void test("opening a scheduled chat reuses its live session", () => {
  assert.equal(shouldReuseLiveSessionOnOpen(session("schedule", false)), true);
  assert.equal(shouldReuseLiveSessionOnOpen(session("schedule", true)), true);
  assert.equal(shouldReuseLiveSessionOnOpen(session("channel", false)), true);
  assert.equal(
    shouldReuseLiveSessionOnOpen(session("interactive", false), "schedule"),
    true,
  );
});

void test("an idle interactive chat can still adopt requested settings", () => {
  assert.equal(
    shouldReuseLiveSessionOnOpen(session("interactive", false)),
    false,
  );
  assert.equal(
    shouldReuseLiveSessionOnOpen(session("interactive", true)),
    true,
  );
  assert.equal(shouldReuseLiveSessionOnOpen(undefined), false);
});

void test("an interrupted mission channel resumes from its durable kickoff", () => {
  const chatId = "channel:workspace:mission";
  const kickoff: AgentEvent = {
    type: "message",
    id: `${chatId}-kickoff`,
    role: "user",
    content: [{ type: "text", text: "Start onboarding." }],
  };
  assert.equal(shouldRecoverOnboardingOnOpen([kickoff], chatId), true);
  assert.equal(
    shouldRecoverOnboardingOnOpen(
      [kickoff, { type: "result", ok: true }],
      chatId,
    ),
    false,
  );
  assert.equal(shouldRecoverOnboardingOnOpen([], chatId), false);
});
