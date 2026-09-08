import assert from "node:assert/strict";
import test from "node:test";

import { agentConfigResultSchema } from "@chief/relay-contracts";

import {
  relayAgentConfig,
  relayAgentPreference,
} from "../src/lib/relay-agent-preferences.ts";

const cloud = agentConfigResultSchema.parse({
  agentId: "chief",
  config: {
    enabled: true,
    deploymentTarget: "cloud",
    inference: {
      provider: "vercel-ai-gateway",
      model: "anthropic/claude-sonnet-4.5",
    },
    approvals: "auto",
    capabilities: [],
    integrations: [],
    toolPermissions: ["messages.read", "messages.send"],
  },
  updatedAt: null,
});

void test("cloud deployment uses Vercel AI Gateway inference", () => {
  const preference = relayAgentPreference(cloud);

  assert.equal(preference.deploymentTarget, "cloud");
  assert.equal(preference.driver, "remote");
  assert.equal(preference.model, "anthropic/claude-sonnet-4.5");
});

void test("choosing a desktop deployment persists OpenCode inference", () => {
  const config = relayAgentConfig(cloud.config, {
    agentId: "chief",
    enabled: true,
    deploymentTarget: "desktop",
    driver: "opencode",
    model: "opencode-go/deepseek-v4-flash",
  });

  assert.equal(config.deploymentTarget, "desktop");
  assert.deepEqual(config.inference, {
    provider: "opencode",
    model: "opencode-go/deepseek-v4-flash",
    secretRef: "opencode",
  });
});

void test("OpenCode keeps its provider and model without changing location", () => {
  const config = relayAgentConfig(cloud.config, {
    agentId: "chief",
    enabled: true,
    deploymentTarget: "phone",
    driver: "opencode",
    model: "opencode-go/deepseek-v4-flash",
  });

  assert.equal(config.deploymentTarget, "phone");
  assert.deepEqual(config.inference, {
    provider: "opencode",
    model: "opencode-go/deepseek-v4-flash",
    secretRef: "opencode",
  });
});

void test("Chief Cloud preserves an explicitly selected OpenCode provider", () => {
  const config = relayAgentConfig(cloud.config, {
    agentId: "chief",
    enabled: true,
    deploymentTarget: "cloud",
    driver: "opencode",
    model: "opencode-go/glm-5.3",
  });

  assert.deepEqual(config.inference, {
    provider: "opencode",
    model: "opencode-go/glm-5.3",
    secretRef: "opencode",
  });
  assert.equal(relayAgentPreference({ ...cloud, config }).driver, "opencode");
});

void test("on-device agents preserve ChatGPT and Claude providers", () => {
  for (const driver of ["codex", "claude"] as const) {
    const config = relayAgentConfig(cloud.config, {
      agentId: "engineer",
      enabled: true,
      deploymentTarget: "desktop",
      driver,
      model: "auto",
    });
    assert.equal(config.deploymentTarget, "desktop");
    assert.deepEqual(config.inference, { provider: driver, model: "auto" });
    assert.equal(relayAgentPreference({ ...cloud, config }).driver, driver);
  }
});

void test("persists any model selected from the Vercel AI Gateway catalog", () => {
  const config = relayAgentConfig(cloud.config, {
    agentId: "chief",
    enabled: true,
    deploymentTarget: "cloud",
    driver: "remote",
    model: "openai/gpt-5.2",
  });

  assert.deepEqual(config.inference, {
    provider: "vercel-ai-gateway",
    model: "openai/gpt-5.2",
    secretRef: "vercel-ai-gateway",
  });
});
