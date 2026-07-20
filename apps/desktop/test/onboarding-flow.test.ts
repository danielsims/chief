import assert from "node:assert/strict";
import test from "node:test";

import {
  LOCAL_ONBOARDING_FALLBACK,
  nextOnboardingStep,
} from "../src/lib/onboarding-flow.js";

void test("onboarding chooses execution before company context", () => {
  assert.equal(nextOnboardingStep("mode"), "inference");
  assert.equal(nextOnboardingStep("inference"), "health");
  assert.equal(nextOnboardingStep("health"), "context");
  assert.equal(nextOnboardingStep("context"), "brand");
});

void test("integration choices capture intent without setup screens", () => {
  assert.equal(nextOnboardingStep("analytics"), "ads");
  assert.equal(nextOnboardingStep("ads"), "adsBudget");
});

void test("cloud deployment can fall back to local setup atomically", () => {
  assert.deepEqual(LOCAL_ONBOARDING_FALLBACK, {
    workspaceMode: "local",
    providerMode: "local",
    provider: null,
    deploymentProvider: null,
    cloudDeploymentUrl: "",
    step: "inference",
  });
});
