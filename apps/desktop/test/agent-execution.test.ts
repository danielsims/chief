import assert from "node:assert/strict";
import test from "node:test";

import {
  agentExecution,
  nativeDeployment,
  relayDeploymentTarget,
  selectDeployment,
} from "../src/lib/agent-execution.ts";

void test("maps relay host targets into one on-device deployment", () => {
  assert.deepEqual(nativeDeployment("desktop"), {
    kind: "on-device",
    relayTarget: "desktop",
  });
  assert.deepEqual(nativeDeployment("phone"), {
    kind: "on-device",
    relayTarget: "phone",
  });
  assert.deepEqual(nativeDeployment("cloud"), { kind: "chief-cloud" });
});

void test("preserves the concrete device host behind the shared UI target", () => {
  const phone = nativeDeployment("phone");
  assert.deepEqual(
    selectDeployment({ kind: "on-device", current: phone }),
    phone,
  );
  assert.equal(relayDeploymentTarget(phone), "phone");

  const device = selectDeployment({
    kind: "on-device",
    current: { kind: "chief-cloud" },
  });
  assert.equal(relayDeploymentTarget(device), "desktop");
});

void test("models Vercel Eve as a deployment instead of an inference provider", () => {
  const execution = agentExecution({
    runtime: {
      kind: "external-channel",
      provider: "eve",
      endpoint: "https://researcher.vercel.app/channels/chief/messages",
      connectionStatus: "connected",
      deployment: { status: "unattested" },
    },
    deploymentTarget: "cloud",
    provider: "remote",
    model: "anthropic/claude-sonnet-4.5",
  });

  assert.deepEqual(execution, {
    deployment: { kind: "vercel-eve", connectionStatus: "connected" },
    inference: { kind: "managed-by-deployment" },
  });
});

void test("keeps native deployment and inference as separate decisions", () => {
  const execution = agentExecution({
    deploymentTarget: "cloud",
    provider: "opencode",
    model: "openai/gpt-5.2-codex",
  });

  assert.deepEqual(execution, {
    deployment: { kind: "chief-cloud" },
    inference: {
      kind: "configured",
      provider: "opencode",
      model: "openai/gpt-5.2-codex",
    },
  });
});
