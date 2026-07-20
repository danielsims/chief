import assert from "node:assert/strict";
import test from "node:test";

import { buildOnboardingWorkJobs } from "../src/lib/onboarding-work.ts";

const base = {
  workspaceId: "workspace",
  companyName: "Program",
  websiteUrl: "https://program.video",
  timezone: "Australia/Brisbane",
  brand: { mode: "research", notes: "", files: [] },
  analytics: { integrations: [] },
  ads: { integrations: [] },
  aeo: { trackAiReferrals: false },
};

void test("initial onboarding schedules one Brand Researcher and one Prospector", () => {
  const jobs = buildOnboardingWorkJobs(base);
  assert.deepEqual(
    jobs.map((job) => job.agentId),
    ["brand", "prospector"],
  );
  assert.match(jobs[1]?.instructions ?? "", /prospectsSave/);
  assert.match(jobs[1]?.instructions ?? "", /direct HTTP source URL/);
});

void test("skipping brand research still populates prospects", () => {
  const jobs = buildOnboardingWorkJobs({
    ...base,
    brand: { ...base.brand, mode: "skip" },
  });
  assert.deepEqual(
    jobs.map((job) => job.agentId),
    ["prospector"],
  );
});

void test("independent post-onboarding work launches before analytics", () => {
  const jobs = buildOnboardingWorkJobs({
    ...base,
    analytics: {
      integrations: [
        {
          domain: "analytics.googleapis.com",
          name: "Google Analytics",
          description: "GA4",
          kinds: ["openapi"],
          url: "https://integrations.sh/analytics.googleapis.com/",
        },
      ],
    },
    ads: {
      integrations: [
        {
          domain: "googleads.googleapis.com",
          name: "Google Ads",
          description: "Google Ads",
          kinds: ["openapi"],
          url: "https://integrations.sh/googleads.googleapis.com/",
        },
      ],
    },
    aeo: { trackAiReferrals: true },
  });

  assert.deepEqual(
    jobs.map((job) => job.agentId),
    ["brand", "setup", "setup", "prospector", "analyst"],
  );
  assert.match(jobs[1]?.instructions ?? "", /analytics\.googleapis\.com/);
  assert.match(jobs[1]?.instructions ?? "", /setupAttemptId=/);
  assert.match(jobs[1]?.instructions ?? "", /initial concurrent kickoff/);
  assert.match(jobs[3]?.instructions ?? "", /Do not wait for brand research/);
  assert.match(jobs[4]?.instructions ?? "", /analyticsSaveDataset/);
});
