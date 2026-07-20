import assert from "node:assert/strict";
import test from "node:test";

import type { OnboardingWorkJob } from "../src/types.ts";
import {
  googleAnalyticsOnboardingAttempt,
  onboardingGoogleAnalyticsOAuthInputRequest,
} from "../src/integration-requests.js";
import { planOnboardingWork } from "../src/onboarding-preflight.js";

const job = (
  agentId: string,
  extra: Partial<OnboardingWorkJob> = {},
): OnboardingWorkJob => ({
  id: agentId,
  agentId,
  title: agentId,
  instructions: agentId,
  runAt: 1,
  timezone: "UTC",
  proposedToolPatterns: [],
  ...extra,
});

void test("defers Google Analytics setup and analysis before credentials", () => {
  const brand = job("brand");
  const setup = job("setup", {
    setupDomain: "analytics.googleapis.com",
    setupAttemptId: "ga-attempt",
  });
  const adsSetup = job("setup", {
    id: "ads",
    setupDomain: "googleads.googleapis.com",
    setupAttemptId: "ads-attempt",
  });
  const analyst = job("analyst");
  const prospector = job("prospector");

  const plan = planOnboardingWork(
    [brand, setup, adsSetup, prospector, analyst],
    false,
  );

  assert.deepEqual(plan.launchableJobs, [brand, adsSetup, prospector]);
  assert.deepEqual(plan.deferredGoogleAnalytics, {
    setupAttemptId: "ga-attempt",
  });
});

void test("keeps all onboarding jobs when credentials are ready", () => {
  const jobs = [
    job("setup", {
      setupDomain: "analytics.googleapis.com",
      setupAttemptId: "ga-attempt",
    }),
    job("analyst"),
  ];
  assert.deepEqual(planOnboardingWork(jobs, true), { launchableJobs: jobs });
  assert.deepEqual(planOnboardingWork(jobs, undefined), {
    launchableJobs: jobs,
  });
});

void test("preserves the deferred Google Analytics setup attempt", () => {
  const request =
    onboardingGoogleAnalyticsOAuthInputRequest("stable-attempt-id");
  assert.equal(
    googleAnalyticsOnboardingAttempt(request.id),
    "stable-attempt-id",
  );
  assert.equal(
    googleAnalyticsOnboardingAttempt("unrelated-request"),
    undefined,
  );
  assert.equal(request.steps?.length, 8);
  assert.equal(request.fields.length, 2);
});
