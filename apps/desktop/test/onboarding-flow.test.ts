import assert from "node:assert/strict";
import test from "node:test";

import {
  nextOnboardingStep,
  resumableOnboardingStep,
} from "../src/lib/onboarding-flow.js";

void test("onboarding chooses execution before company context", () => {
  assert.equal(nextOnboardingStep("mode"), "inference");
  assert.equal(nextOnboardingStep("inference"), "health");
  assert.equal(nextOnboardingStep("health"), "context");
  assert.equal(nextOnboardingStep("context"), "plugins");
});

void test("tools are the last onboarding question", () => {
  assert.equal(nextOnboardingStep("plugins"), "finish");
});

void test("legacy drafts resume without revisiting removed questions", () => {
  assert.equal(resumableOnboardingStep("brand"), "plugins");
  assert.equal(resumableOnboardingStep("monitoring"), "plugins");
  assert.equal(resumableOnboardingStep("automation"), "finish");
});
