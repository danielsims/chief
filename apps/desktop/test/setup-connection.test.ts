import assert from "node:assert/strict";
import test from "node:test";

import {
  agentIdSchema,
  defaultAgentConfig,
  workspaceSnapshotSchema,
} from "@chief/relay-contracts";

import { newSetupDraft } from "../src/pages/onboarding/model.js";
import { applySetupConnection } from "../src/pages/onboarding/setup-connection.js";

const snapshot = workspaceSnapshotSchema.parse({
  id: "workspace-one",
  name: "One",
  website: "",
  runtime: "desktop",
  imageURL: null,
  onboardingComplete: false,
  agents: [
    {
      id: "chief",
      name: "Chief",
      role: "Chief",
      status: "idle",
      subagents: [{ id: "marketer", name: "Marketer", role: "Marketing" }],
    },
  ],
  conversations: [],
  projects: [],
  createdAt: "2026-08-28T00:00:00.000Z",
});

function fixture(saved: string[] = []) {
  const writes: { id: string; config: typeof defaultAgentConfig }[] = [];
  const secrets: { name: string; value: string }[] = [];
  const client = {
    listWorkspaceSecrets: () =>
      Promise.resolve(
        saved.map((name) => ({ name, updatedAt: "2026-08-28T00:00:00.000Z" })),
      ),
    setWorkspaceSecret: (name: string, value: string) => {
      secrets.push({ name, value });
      return Promise.resolve({ name, workspaceId: snapshot.id });
    },
    loadAgentConfig: (id: string) =>
      Promise.resolve({
        agentId: agentIdSchema.parse(id),
        config: {
          ...defaultAgentConfig,
          deploymentTarget: "desktop" as const,
          inference: { provider: "codex" as const, model: "auto" },
        },
        updatedAt: "2026-08-28T00:00:00.000Z",
      }),
    saveAgentConfig: (id: string, config: typeof defaultAgentConfig) => {
      writes.push({ id, config });
      return Promise.resolve({
        agentId: agentIdSchema.parse(id),
        config,
        updatedAt: "2026-08-28T00:00:00.000Z",
      });
    },
  };
  return { client, writes, secrets };
}

void test("an existing device workspace still needs a cloud key", async () => {
  const { client, writes } = fixture();
  await assert.rejects(
    applySetupConnection(
      client,
      snapshot,
      { ...newSetupDraft(), workspaceId: snapshot.id, location: "cloud" },
      "",
    ),
    /Paste an API key/,
  );
  assert.equal(writes.length, 0);
});

for (const service of ["vercelAiGateway", "opencode"] as const) {
  void test(`switching device to ${service} saves the key and updates the whole team`, async () => {
    const { client, writes, secrets } = fixture();
    await applySetupConnection(
      client,
      snapshot,
      { ...newSetupDraft(), location: "cloud", service },
      " test-key ",
    );
    assert.deepEqual(secrets, [
      {
        name: service === "opencode" ? "opencode" : "vercel-ai-gateway",
        value: "test-key",
      },
    ]);
    assert.deepEqual(
      writes.map((write) => write.id),
      ["chief", "marketer"],
    );
    assert.ok(
      writes.every(
        (write) =>
          write.config.deploymentTarget === "cloud" &&
          write.config.inference.provider ===
            (service === "opencode" ? "opencode" : "vercel-ai-gateway"),
      ),
    );
  });
}

void test("a key for another service cannot satisfy the chosen service", async () => {
  const { client } = fixture(["opencode"]);
  await assert.rejects(
    applySetupConnection(
      client,
      snapshot,
      { ...newSetupDraft(), location: "cloud" },
      "",
    ),
    /Paste an API key/,
  );
});

void test("a saved key for the selected service can be reused", async () => {
  const { client, secrets, writes } = fixture(["vercel-ai-gateway"]);
  await applySetupConnection(
    client,
    snapshot,
    { ...newSetupDraft(), location: "cloud" },
    "",
  );
  assert.equal(secrets.length, 0);
  assert.equal(writes.length, 2);
});

void test("Eve defers configuration to its deployment screen", async () => {
  const { client, writes, secrets } = fixture();
  await applySetupConnection(
    client,
    snapshot,
    { ...newSetupDraft(), location: "cloud", host: "vercel-eve" },
    "",
  );
  assert.equal(writes.length, 0);
  assert.equal(secrets.length, 0);
});

void test("returning to device updates deployment and the selected model", async () => {
  const { client, writes } = fixture();
  await applySetupConnection(
    client,
    snapshot,
    { ...newSetupDraft(), localProvider: "claude", localModel: "sonnet" },
    "",
  );
  assert.ok(
    writes.every(
      (write) =>
        write.config.deploymentTarget === "desktop" &&
        write.config.inference.provider === "claude" &&
        write.config.inference.model === "sonnet",
    ),
  );
});
