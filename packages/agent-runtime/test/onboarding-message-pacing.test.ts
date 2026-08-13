import assert from "node:assert/strict";
import test from "node:test";

import { ONBOARDING_OPENING_MESSAGE } from "../src/onboarding-kickoff.js";
import { OnboardingMessagePacer } from "../src/onboarding-message-pacing.js";

void test("onboarding publications leave readable space without slowing ordinary chat", async () => {
  let now = 1_000;
  const waits: number[] = [];
  const pacer = new OnboardingMessagePacer(
    2_500,
    () => now,
    (delayMs) => {
      waits.push(delayMs);
      now += delayMs;
      return Promise.resolve();
    },
  );

  await pacer.beforePost("workspace", { content: ONBOARDING_OPENING_MESSAGE });
  await pacer.beforePost("workspace", {
    content: "Hey @Marketer",
    idempotencyKey: "onboarding-marketer-thread",
  });
  await pacer.beforePost("workspace", {
    content: "An ordinary follow-up",
    idempotencyKey: "follow-up",
  });
  await pacer.beforePost("workspace", {
    content: "Hey @Prospector",
    idempotencyKey: "onboarding-prospector-thread",
  });

  assert.deepEqual(waits, [2_500, 2_500]);
});

void test("separate workspaces pace independently", async () => {
  const waits: number[] = [];
  const pacer = new OnboardingMessagePacer(
    2_500,
    () => 1_000,
    (delayMs) => {
      waits.push(delayMs);
      return Promise.resolve();
    },
  );

  await pacer.beforePost("workspace-a", {
    content: ONBOARDING_OPENING_MESSAGE,
  });
  await pacer.beforePost("workspace-b", {
    content: ONBOARDING_OPENING_MESSAGE,
  });

  assert.deepEqual(waits, []);
});
