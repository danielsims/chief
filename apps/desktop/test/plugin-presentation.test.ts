import assert from "node:assert/strict";
import test from "node:test";

import type { AgentPluginSummary } from "@chief/agent-runtime/types";

import {
  onboardingPluginOptions,
  pluginCategoryLabel,
  pluginDomain,
} from "../src/lib/plugin-presentation.js";

function plugin(
  id: string,
  name: string,
  domain: string | undefined,
  category: string,
  description: string,
): AgentPluginSummary {
  return {
    id,
    name,
    description,
    category,
    ...(domain ? { domains: [domain] } : {}),
    source: {
      type: "git",
      url: `https://github.com/example/${id}`,
      sha: "a".repeat(40),
    },
    status: "available",
    enabled: false,
    trusted: false,
  };
}

void test("normalizes coarse catalog tags using the app's actual purpose", () => {
  assert.equal(
    pluginCategoryLabel(
      plugin(
        "posthog",
        "PostHog",
        "posthog.com",
        "code",
        "Product analytics, feature flags, experiments, and insights.",
      ),
    ),
    "Data & Analytics",
  );
  assert.equal(
    pluginCategoryLabel(
      plugin(
        "figma",
        "Figma",
        "figma.com",
        "development",
        "Design context and design-to-code workflows.",
      ),
    ),
    "Design & Creative",
  );
  assert.equal(
    pluginCategoryLabel(
      plugin(
        "slack",
        "Slack",
        "slack.com",
        "productivity",
        "Search channels and team conversations.",
      ),
    ),
    "Communication",
  );
});

void test("keeps preferred apps first and excludes domainless skill packages", () => {
  const options = onboardingPluginOptions([
    plugin("figma", "Figma", "figma.com", "development", "Design files"),
    plugin("slack", "Slack", "slack.com", "productivity", "Messages"),
    plugin("granola", "Granola", "granola.ai", "productivity", "Meetings"),
    plugin("skill", "A coding skill", undefined, "development", "Code well"),
  ]);

  assert.deepEqual(
    options.map((candidate) => candidate.id),
    ["slack", "granola", "figma"],
  );
  const first = options[0];
  assert.ok(first);
  assert.equal(pluginDomain(first), "slack.com");
});

void test("uses declared provider domains instead of a git repository host", () => {
  const vercel = plugin(
    "vercel",
    "Vercel",
    "vercel.com",
    "deployment",
    "Build and deploy apps.",
  );
  vercel.homepage = "https://github.com/vercel/vercel";

  assert.equal(pluginDomain(vercel), "vercel.com");
});
