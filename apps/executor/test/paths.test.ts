import assert from "node:assert/strict";
import test from "node:test";

import { executionLeaseSchema } from "@chief/relay-contracts";

import { executionRoot, resolveExecutionPath } from "../src/paths";

void test("execution paths remain under their root", () => {
  assert.equal(
    resolveExecutionPath("/workspace", "src/index.ts"),
    "/workspace/src/index.ts",
  );
  assert.throws(() => resolveExecutionPath("/workspace", "../secret"));
  assert.throws(() => resolveExecutionPath("/workspace", "/etc/passwd"));
});

void test("each durable agent receives an isolated persistent root", () => {
  const lease = executionLeaseSchema.parse({
    id: "2b759f79-d53a-4a69-af78-c291a30bd765",
    workspaceId: "workspace-one",
    agentId: "engineer",
    placementEpoch: 1,
    capabilities: ["process:exec"],
    resources: {
      cpuMillis: 1_000,
      memoryMib: 1_024,
      diskMib: 2_048,
      wallTimeSeconds: 900,
    },
    network: { mode: "deny", allowedHosts: [] },
    issuedAt: "2026-08-26T00:00:00.000Z",
    expiresAt: "2026-08-26T00:15:00.000Z",
  });
  assert.equal(
    executionRoot("/computers", lease),
    "/computers/workspaces/workspace-one/agents/engineer",
  );
});
