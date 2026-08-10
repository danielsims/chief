import assert from "node:assert/strict";
import test from "node:test";

import { AgentSessionCapabilityRegistry } from "../src/agent-session-capabilities.js";

void test("agent sessions receive isolated expiring credentials", () => {
  const capabilities = new AgentSessionCapabilityRegistry();
  const now = 1_000_000;
  const engineer = capabilities.agentSession(
    { workspaceId: "workspace", agentId: "engineer", sessionId: "session-a" },
    now,
  );
  const researcher = capabilities.agentSession(
    { workspaceId: "workspace", agentId: "researcher", sessionId: "session-b" },
    now,
  );

  assert.match(engineer, /^chief_agent_/);
  assert.notEqual(engineer, researcher);
  assert.deepEqual(capabilities.authenticate(engineer, now), {
    kind: "agent-session",
    workspaceId: "workspace",
    agentId: "engineer",
    sessionId: "session-a",
    expiresAt: now + 12 * 60 * 60_000,
  });
  assert.equal(
    capabilities.authenticate(engineer, now + 12 * 60 * 60_000),
    undefined,
  );
});

void test("rotating a session revokes its previous agent credential", () => {
  const capabilities = new AgentSessionCapabilityRegistry();
  const first = capabilities.agentSession(
    { workspaceId: "workspace", agentId: "engineer", sessionId: "session" },
    1_000,
  );
  const rotated = capabilities.agentSession(
    { workspaceId: "workspace", agentId: "researcher", sessionId: "session" },
    2_000,
  );
  assert.notEqual(first, rotated);
  assert.equal(capabilities.authenticate(first, 2_000), undefined);
  assert.equal(
    capabilities.authenticate(rotated, 2_000)?.kind,
    "agent-session",
  );
});

void test("the Executor gateway is workspace-scoped and stable", () => {
  const capabilities = new AgentSessionCapabilityRegistry();
  const first = capabilities.workspaceGateway("workspace-a");
  assert.equal(capabilities.workspaceGateway("workspace-a"), first);
  assert.notEqual(capabilities.workspaceGateway("workspace-b"), first);
  assert.deepEqual(capabilities.authenticate(first), {
    kind: "workspace-gateway",
    workspaceId: "workspace-a",
  });
});
