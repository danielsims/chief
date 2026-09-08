import assert from "node:assert/strict";
import test from "node:test";

import type {
  AgentDefinition,
  AgentPreference,
} from "@chief/agent-runtime/types";

import { executionPreferencesForTeam } from "../src/lib/agent-execution-preferences.ts";

const agents: AgentDefinition[] = [
  {
    id: "chief",
    name: "Chief",
    role: "Chief of staff",
    description: "Coordinates the team.",
    instructions: "",
  },
  {
    id: "brand",
    name: "Brand",
    role: "Brand strategist",
    description: "Owns brand work.",
    instructions: "",
  },
  {
    id: "researcher",
    name: "Researcher",
    role: "External agent",
    description: "Runs in Vercel Eve.",
    instructions: "",
    runtime: {
      kind: "external-channel",
      provider: "eve",
      endpoint: "https://researcher.vercel.app/channels/chief/messages",
      connectionStatus: "connected",
      deployment: { status: "unattested" },
    },
  },
];

void test("team assignment preserves native policy and skips Eve agents", () => {
  const current: AgentPreference[] = [
    {
      agentId: "chief",
      enabled: false,
      approvals: "ask",
      integrations: ["slack"],
    },
  ];

  const next = executionPreferencesForTeam(
    agents,
    current,
    "desktop",
    "codex",
    "gpt-5.6",
  );

  assert.deepEqual(next, [
    {
      agentId: "chief",
      enabled: false,
      approvals: "ask",
      integrations: ["slack"],
      deploymentTarget: "desktop",
      driver: "codex",
      model: "gpt-5.6",
    },
    {
      agentId: "brand",
      enabled: true,
      deploymentTarget: "desktop",
      driver: "codex",
      model: "gpt-5.6",
    },
  ]);
});
