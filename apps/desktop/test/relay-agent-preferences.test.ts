import assert from "node:assert/strict";
import test from "node:test";

import { agentConfigResultSchema } from "@chief/relay-contracts";

import {
  relayAgentConfig,
  relayAgentPreference,
} from "../src/lib/relay-agent-preferences.ts";

const unassigned = agentConfigResultSchema.parse({
  agentId: "chief",
  config: {
    enabled: true,
    providerAssigned: false,
    driver: "openCodeGo",
    model: "deepseek-v4-flash-free",
    approvals: "auto",
    capabilities: [],
    integrations: [],
    toolPermissions: ["messages.read", "messages.send"],
  },
  updatedAt: null,
});

void test("an unassigned relay default stays unassigned in agent settings", () => {
  const preference = relayAgentPreference(unassigned);

  assert.equal(preference.driver, undefined);
  assert.equal(preference.model, undefined);
});

void test("choosing Codex explicitly assigns the relay agent provider", () => {
  const config = relayAgentConfig(unassigned.config, {
    agentId: "chief",
    enabled: true,
    driver: "codex",
  });

  assert.equal(config.providerAssigned, true);
  assert.equal(config.driver, "codex");
  assert.equal(config.model, "auto");
});

void test("OpenCode uses the relay's portable driver identifier", () => {
  const config = relayAgentConfig(unassigned.config, {
    agentId: "chief",
    enabled: true,
    driver: "opencode",
    model: "opencode-go/deepseek-v4-flash",
  });

  assert.equal(config.driver, "openCodeGo");
  assert.equal(config.model, "opencode-go/deepseek-v4-flash");
});
