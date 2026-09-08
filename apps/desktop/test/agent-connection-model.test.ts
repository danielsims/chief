import assert from "node:assert/strict";
import test from "node:test";

import {
  chiefChannelConfiguration,
  eveDeploymentInstructions,
  externalAgentSourcePresentation,
  isReservedVercelProjectName,
  nativeProvidersForDeployment,
  preferredVercelProjectName,
  relayRuntimeIdentity,
  suggestedVercelProjectName,
  validateEveConnection,
} from "../src/components/agents/agent-connection-model.ts";

void test("Eve deployment preserves configured agent instructions", () => {
  assert.equal(
    eveDeploymentInstructions({
      id: "custom-researcher",
      name: "Researcher",
      role: "researcher",
      description: "Finds source-backed answers.",
      instructions: "  Follow the evidence.  ",
    }),
    "Follow the evidence.",
  );
});

void test("Eve deployment gives bundled agents a complete instruction document", () => {
  const instructions = eveDeploymentInstructions({
    id: "custom-chief",
    name: "Chief",
    role: "chief of staff",
    description: "Coordinates the workspace.",
    instructions: "",
  });

  assert.match(instructions, /^# Identity/mu);
  assert.match(
    instructions,
    /You are Chief, the workspace's chief of staff\./u,
  );
  assert.match(instructions, /Coordinates the workspace\./u);
  assert.ok(instructions.length > 1);
});

void test("Eve deployment restores the canonical repository instructions for bundled agents", () => {
  const instructions = eveDeploymentInstructions({
    id: "chief",
    name: "Chief",
    role: "Workspace Lead",
    description: "Coordinates the workspace.",
    instructions: "",
  });

  assert.match(
    instructions,
    /You are Chief, this workspace's lead operator\./u,
  );
  assert.match(instructions, /## Your team/u);
});

void test("runtime labels preserve the active relay trust boundary", () => {
  assert.deepEqual(
    relayRuntimeIdentity(
      "https://chief.example.com/path",
      "https://chief.example.com",
    ),
    { kind: "chief-cloud" },
  );
  assert.deepEqual(
    relayRuntimeIdentity(
      "https://relay.acme.example/workspaces/one",
      "https://chief.example.com",
    ),
    { kind: "self-hosted", name: "relay.acme.example" },
  );
  assert.deepEqual(
    relayRuntimeIdentity("http://localhost:8787", "https://chief.example.com"),
    { kind: "self-hosted", name: "localhost:8787" },
  );
});

void test("Vercel project names use the workspace and skip Chief's own projects", () => {
  assert.equal(
    suggestedVercelProjectName("Acme", [], "ws_abcdef123456"),
    "acme-chief",
  );
  assert.equal(
    suggestedVercelProjectName("Chief", ["chief"], "ws_abcdef123456"),
    "chief-chief",
  );
  assert.equal(
    suggestedVercelProjectName(
      "Chief",
      ["chief", "chief-chief"],
      "ws_abcdef123456",
    ),
    "chief-chief-2",
  );
  assert.equal(suggestedVercelProjectName("  ", [], ""), "workspace-chief");
  assert.notEqual(suggestedVercelProjectName("Chief", [], ""), "chief");
  assert.notEqual(suggestedVercelProjectName("Chief Web", [], ""), "chief-web");
  assert.equal(isReservedVercelProjectName("chief-web"), true);
  assert.equal(isReservedVercelProjectName("program-chief"), false);
  assert.equal(
    preferredVercelProjectName("Program", "program-eve"),
    "program-chief",
  );
  assert.equal(
    preferredVercelProjectName("Program", "program-eve-2"),
    "program-chief",
  );
  assert.equal(
    preferredVercelProjectName("Program", "custom-agent"),
    "custom-agent",
  );
});

void test("on-device agents expose every supported local harness", () => {
  assert.deepEqual(nativeProvidersForDeployment("on-device"), [
    "opencode",
    "codex",
    "claude",
  ]);
  assert.deepEqual(nativeProvidersForDeployment("chief-cloud"), [
    "remote",
    "opencode",
  ]);
});

void test("Eve connections require a Project and verified Vercel origin", () => {
  const base = {
    agentId: "researcher",
    endpoint: "https://researcher.vercel.app/channels/chief/messages",
    projectId: "project-1",
    path: "agent/index.ts",
    ref: "main",
  };
  assert.equal(validateEveConnection(base), null);
  assert.match(
    validateEveConnection({ ...base, projectId: "" }) ?? "",
    /Project/,
  );
  assert.match(
    validateEveConnection({ ...base, endpoint: "http://localhost:3000" }) ?? "",
    /vercel\.app/,
  );
  assert.match(
    validateEveConnection({
      ...base,
      endpoint: "https://vercel.app.evil.test",
    }) ?? "",
    /vercel\.app/,
  );
});

void test("repository provenance never overstates unresolved source or deployment", () => {
  assert.deepEqual(
    externalAgentSourcePresentation(
      {
        kind: "repository",
        projectId: "project-1",
        repositoryId: "repository-1",
        repository: { provider: "github", owner: "chief", name: "agent" },
        path: "agent/index.ts",
        requestedRef: "main",
        verification: { status: "unresolved", reason: "App not connected" },
      },
      { status: "unattested" },
    ),
    {
      repository: "chief/agent",
      revision: "Project linked · revision pending verification",
      deployment: "Deployment not attested",
    },
  );
});

void test("verified source and deployment use their independent immutable revisions", () => {
  const sourceSha = "a".repeat(40);
  const deploymentSha = "b".repeat(40);
  assert.deepEqual(
    externalAgentSourcePresentation(
      {
        kind: "repository",
        projectId: "project-1",
        repositoryId: "repository-1",
        repository: { provider: "github", owner: "chief", name: "agent" },
        path: "agent/index.ts",
        requestedRef: "main",
        verification: {
          status: "verified",
          resolvedCommitSha: sourceSha,
          contentDigest: `sha256:${"c".repeat(64)}`,
        },
      },
      {
        status: "attested",
        resolvedCommitSha: deploymentSha,
        attestedAt: "2026-08-30T00:00:00.000Z",
      },
    ),
    {
      repository: "chief/agent",
      revision: "Verified at aaaaaaa",
      deployment: "Deployment attested at bbbbbbb",
    },
  );
});

void test("registration success renders a complete one-time channel configuration", () => {
  const configuration = chiefChannelConfiguration({
    agentId: "researcher",
    token: "secret-token",
    deliverySigningKeyId: "signing-key-v1",
    deliverySigningSecret: "delivery-signing-secret",
    inboundUrl:
      "https://relay.example/v1/workspaces/workspace-1/agents/researcher/channel/messages",
  });
  assert.match(configuration, /CHIEF_AGENT_ID=researcher/);
  assert.match(configuration, /CHIEF_CHANNEL_TOKEN=secret-token/);
  assert.match(configuration, /CHIEF_DELIVERY_SIGNING_KEY_ID=signing-key-v1/);
  assert.match(configuration, /CHIEF_RELAY_URL=https:\/\/relay\.example/);
  assert.match(configuration, /CHIEF_WORKSPACE_ID=workspace-1/);
});
