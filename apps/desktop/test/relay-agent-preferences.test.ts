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
      provider: "opencode",
      model: "opencode-go/deepseek-v4-flash",
    },
    approvals: "auto",
    capabilities: [],
    integrations: [],
    toolPermissions: ["messages.read", "messages.send"],
  },
  updatedAt: null,
});

void test("cloud deployment uses OpenCode Go inference", () => {
  const preference = relayAgentPreference(cloud);

  assert.equal(preference.deploymentTarget, "cloud");
  assert.equal(preference.driver, "remote");
  assert.equal(preference.model, "opencode-go/deepseek-v4-flash");
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
  });
});
