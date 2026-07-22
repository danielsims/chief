import assert from "node:assert/strict";
import test from "node:test";

import { onboardingEngineeringSetup } from "../src/lib/onboarding-engineering.js";

const organization = {
  id: "workspace-1",
  name: "Acme",
  slug: "acme",
  metadata: {
    onboarding: {
      engineering: {
        enabled: true,
        integrations: [{ domain: "github.com" }, { domain: "vercel.com" }],
      },
    },
  },
};

void test("engineering setup advances through selected unconnected tools", () => {
  const first = onboardingEngineeringSetup("workspace-1", organization, []);
  assert.equal(first.nextIntegration?.name, "GitHub");
  assert.equal(first.action?.title, "Set up engineering tools");

  const second = onboardingEngineeringSetup("workspace-1", organization, [
    {
      provider: "github.com",
      category: "engineering",
      status: "connected",
    },
  ]);
  assert.equal(second.nextIntegration?.name, "Vercel");

  const complete = onboardingEngineeringSetup("workspace-1", organization, [
    {
      provider: "github.com",
      category: "engineering",
      status: "connected",
    },
    {
      provider: "vercel.com",
      category: "engineering",
      status: "connected",
    },
  ]);
  assert.deepEqual(complete, {});
});

void test("engineering setup stays absent when onboarding opted out", () => {
  const optedOut = {
    ...organization,
    metadata: {
      onboarding: {
        engineering: {
          enabled: false,
          integrations: [{ domain: "github.com" }],
        },
      },
    },
  };
  assert.deepEqual(onboardingEngineeringSetup("workspace-1", optedOut, []), {});
});
