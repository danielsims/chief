import assert from "node:assert/strict";
import test from "node:test";

import type { AgentEvent } from "../src/types.js";
import {
  ONBOARDING_OPENING_MESSAGE,
  onboardingDirectory,
  onboardingKickoffId,
  onboardingKickoffProgress,
  onboardingOpeningIsVisible,
  onboardingRecoveryPrompt,
} from "../src/onboarding-kickoff.js";

const kickoffId = onboardingKickoffId("getting-started");
const kickoffPrompt: AgentEvent = {
  type: "message",
  id: kickoffId,
  role: "user",
  content: [{ type: "text", text: "Start onboarding." }],
};

void test("the opening sounds conversational and avoids em dashes", () => {
  assert.match(ONBOARDING_OPENING_MESSAGE, /^Hey, welcome to Chief 👋/);
  assert.match(ONBOARDING_OPENING_MESSAGE, /good opportunities are hiding/);
  assert.match(ONBOARDING_OPENING_MESSAGE, /I'll give you a shout/);
  assert.doesNotMatch(ONBOARDING_OPENING_MESSAGE, /—/);
});

void test("onboarding files live inside the owning agent workspace", () => {
  assert.equal(
    onboardingDirectory("/workspaces/acme", "cmo"),
    "/workspaces/acme/agents/cmo/onboarding",
  );
});

void test("local recovery resumes the durable plan without a second greeting", () => {
  const prompt = onboardingRecoveryPrompt("opencode", false);
  assert.match(prompt, /Read onboarding\/getting-started\.md/);
  assert.match(prompt, /do not greet the user again/);
  assert.match(prompt, /concurrently and exactly once/);
});

void test("recovery includes the exact opener only when no opener is visible", () => {
  const prompt = onboardingRecoveryPrompt("opencode", true);
  assert.equal(prompt.includes(ONBOARDING_OPENING_MESSAGE), true);
  assert.equal(
    onboardingRecoveryPrompt("opencode", false).includes(
      ONBOARDING_OPENING_MESSAGE,
    ),
    false,
  );
  assert.equal(onboardingOpeningIsVisible([kickoffPrompt], kickoffId), false);
  assert.equal(
    onboardingOpeningIsVisible(
      [
        kickoffPrompt,
        {
          type: "message",
          role: "assistant",
          content: [{ type: "text", text: "Welcome to Chief." }],
        },
      ],
      kickoffId,
    ),
    false,
  );
  assert.equal(
    onboardingOpeningIsVisible(
      [
        kickoffPrompt,
        {
          type: "message",
          role: "assistant",
          content: [{ type: "text", text: ONBOARDING_OPENING_MESSAGE }],
        },
      ],
      kickoffId,
    ),
    true,
  );
});

void test("an opening message alone does not complete onboarding", () => {
  assert.deepEqual(
    onboardingKickoffProgress(
      [
        {
          type: "message",
          role: "assistant",
          content: [{ type: "text", text: "Welcome to Chief." }],
        },
        kickoffPrompt,
      ],
      kickoffId,
    ),
    { started: true, completed: false },
  );
});

void test("partial output and a failed turn remain resumable", () => {
  assert.deepEqual(
    onboardingKickoffProgress(
      [
        kickoffPrompt,
        {
          type: "message",
          role: "assistant",
          content: [{ type: "text", text: "I'll get this set up." }],
        },
        { type: "result", ok: false, error: "Agent stopped." },
      ],
      kickoffId,
    ),
    { started: true, completed: false },
  );
});

void test("only a successful result completes the kickoff", () => {
  assert.deepEqual(
    onboardingKickoffProgress(
      [kickoffPrompt, { type: "result", ok: true }],
      kickoffId,
    ),
    { started: true, completed: true },
  );
});
