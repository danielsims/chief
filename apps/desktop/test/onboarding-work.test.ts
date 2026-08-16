import assert from "node:assert/strict";
import test from "node:test";

import { buildOnboardingWorkJobs } from "../src/lib/onboarding-work.ts";

const github = {
  domain: "github.com",
  name: "GitHub",
  description: "Repositories and pull requests",
  kinds: ["mcp"],
  url: "https://integrations.sh/github.com/",
};

const vercel = {
  domain: "vercel.com",
  name: "Vercel",
  description: "Deployments and projects",
  kinds: ["mcp"],
  url: "https://integrations.sh/vercel.com/",
};

const base = {
  workspaceId: "workspace",
  companyName: "Program",
  websiteUrl: "https://program.video",
  timezone: "Australia/Brisbane",
  brand: { mode: "research", notes: "", files: [] },
  plugins: { integrations: [] },
};

void test("initial onboarding starts bounded brand, engineering, and prospect work", () => {
  const jobs = buildOnboardingWorkJobs(base);
  assert.deepEqual(
    jobs.map((job) => job.agentId),
    ["brand", "engineer", "prospector"],
  );
  assert.match(jobs[2]?.instructions ?? "", /prospectsSave/);
  assert.match(jobs[2]?.instructions ?? "", /direct HTTP source URL/);
});

void test("skipping brand research still prepares Engineering and prospects", () => {
  const jobs = buildOnboardingWorkJobs({
    ...base,
    brand: { ...base.brand, mode: "skip" },
  });
  assert.deepEqual(
    jobs.map((job) => job.agentId),
    ["engineer", "prospector"],
  );
});

void test("tools already in use are context, not automatic connection jobs", () => {
  const jobs = buildOnboardingWorkJobs({
    ...base,
    plugins: { integrations: [github, vercel] },
  });

  const engineering = jobs.find((job) => job.agentId === "engineer");
  assert.match(engineering?.instructions ?? "", /GitHub \(github\.com\)/);
  assert.match(engineering?.instructions ?? "", /Vercel \(vercel\.com\)/);
  assert.match(engineering?.instructions ?? "", /relevance, never as proof/);
  assert.match(
    engineering?.instructions ?? "",
    /required baseline recommendation/,
  );
  assert.match(
    engineering?.instructions ?? "",
    /every selected service as an actionable inline card/,
  );
  assert.match(
    engineering?.instructions ?? "",
    /Do not replace a selected service/,
  );
  assert.match(engineering?.instructions ?? "", /localTools\.pluginsList/);
  assert.match(engineering?.instructions ?? "", /localTools\.pluginsRecommend/);
  assert.match(engineering?.instructions ?? "", /actionable inline card/);
  assert.ok(
    engineering?.proposedToolPatterns.includes(
      "tools.chief-local.org.localworkspace.localTools.pluginsList",
    ),
  );
  assert.ok(
    engineering?.proposedToolPatterns.includes(
      "tools.chief-local.org.localworkspace.localTools.pluginsRecommend",
    ),
  );
  assert.equal(
    jobs.some((job) => job.setupDomain),
    false,
  );
  assert.equal(
    jobs.some((job) => job.agentId === "setup"),
    false,
  );
});

void test("specialists progressively gather only material missing context", () => {
  const jobs = buildOnboardingWorkJobs(base);
  const marketer = jobs.find((job) => job.agentId === "brand");
  const prospector = jobs.find((job) => job.agentId === "prospector");

  assert.match(marketer?.instructions ?? "", /one compact structured question/);
  assert.match(
    prospector?.instructions ?? "",
    /one compact structured question/,
  );
  assert.match(
    prospector?.instructions ?? "",
    /Do not assume setup already captured/,
  );
});
