import assert from "node:assert/strict";
import test from "node:test";

import { RelayClient } from "@chief/relay-client";
import { workspaceIdSchema } from "@chief/relay-contracts";

import { provisionEveAgent } from "../src/lib/vercel-eve-runtime.ts";

void test("falls back to the relay when this machine has no Vercel token", async () => {
  let relayCalled = false;
  const client = new RelayClient({
    relayUrl: "https://relay.test",
    workspaceId: workspaceIdSchema.parse("workspace-a"),
    getAuthorization: () => Promise.resolve("Nostr signed-request"),
    fetch: () => {
      relayCalled = true;
      return Promise.resolve(
        new Response(
          `${JSON.stringify({
            kind: "complete",
            result: {
              deploymentId: "dpl_relay",
              deploymentUrl: "https://relay-eve.vercel.app",
              projectId: "prj_relay",
            },
          })}\n`,
          { headers: { "content-type": "application/x-ndjson" } },
        ),
      );
    },
  });

  const result = await provisionEveAgent({
    client,
    input: {
      teamId: "team_123",
      project: { kind: "new", projectName: "relay-eve" },
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
  });

  assert.equal(relayCalled, true);
  assert.equal(result.deploymentId, "dpl_relay");
});
