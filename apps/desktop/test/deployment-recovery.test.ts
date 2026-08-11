import assert from "node:assert/strict";
import test from "node:test";

import {
  isDeploymentRecoveryAction,
  localChiefPreference,
} from "../src/lib/deployment-recovery";

void test("recognizes current and legacy missing deployment actions", () => {
  const base = {
    agentId: "chief",
    title: "Connect Chief",
    status: "open" as const,
    createdAt: 1,
  };
  assert.equal(
    isDeploymentRecoveryAction({
      ...base,
      id: "action-chief-deployment-required-workspace",
      reason: "Connect Chief.",
    }),
    true,
  );
  assert.equal(
    isDeploymentRecoveryAction({
      ...base,
      id: "legacy",
      reason: "The deployment could not be found. DEPLOYMENT_NOT_FOUND syd1",
    }),
    true,
  );
  assert.equal(
    isDeploymentRecoveryAction({
      ...base,
      id: "generic",
      reason: "A report failed.",
    }),
    false,
  );
});

void test("local recovery preserves assignments and clears the remote model", () => {
  assert.deepEqual(
    localChiefPreference({
      agentId: "chief",
      enabled: true,
      driver: "remote",
      model: "xai/grok-4.3",
      capabilities: ["schedule-manager"],
      integrations: ["google-analytics"],
    }),
    {
      agentId: "chief",
      enabled: true,
      driver: "codex",
      model: undefined,
      capabilities: ["schedule-manager"],
      integrations: ["google-analytics"],
    },
  );
});
