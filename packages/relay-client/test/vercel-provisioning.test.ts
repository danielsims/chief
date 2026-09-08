import assert from "node:assert/strict";
import test from "node:test";

import { workspaceIdSchema } from "@chief/relay-contracts";

import { RelayClient } from "../src/relay-client";

void test("streams Vercel Eve provisioning progress before returning the deployment", async () => {
  const events = [
    { kind: "progress", progress: { phase: "validating" } },
    {
      kind: "progress",
      progress: {
        phase: "checking",
        deploymentId: "dpl_123",
        deploymentUrl: "https://chief-test.vercel.app",
        projectId: "prj_123",
      },
    },
    {
      kind: "complete",
      result: {
        deploymentId: "dpl_123",
        deploymentUrl: "https://chief-test.vercel.app",
        projectId: "prj_123",
      },
    },
  ];
  const client = new RelayClient({
    relayUrl: "https://relay.test",
    workspaceId: workspaceIdSchema.parse("workspace-a"),
    getAuthorization: () => Promise.resolve("Nostr signed-request"),
    fetch: () =>
      Promise.resolve(
        new Response(
          `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
          {
            headers: { "content-type": "application/x-ndjson" },
          },
        ),
      ),
  });
  const phases: string[] = [];

  const result = await client.provisionVercelEve(
    {
      teamId: "team_123",
      project: { kind: "new", projectName: "chief-test" },
      agent: {
        id: "chief",
        name: "Chief",
        description: "Coordinates the workspace.",
        instructions: "Coordinate the workspace.",
        model: "deepseek/deepseek-v4-flash",
      },
      environment: {
        CHIEF_AGENT_ID: "chief",
        CHIEF_CHANNEL_TOKEN: "channel-token",
        CHIEF_DELIVERY_SIGNING_KEY_ID: "key-id",
        CHIEF_DELIVERY_SIGNING_SECRET: "signing-secret",
        CHIEF_RELAY_URL: "https://relay.test",
        CHIEF_WORKSPACE_ID: "workspace-a",
      },
    },
    (progress) => phases.push(progress.phase),
  );

  assert.deepEqual(phases, ["validating", "checking"]);
  assert.equal(result.deploymentId, "dpl_123");
});
