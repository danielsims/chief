import assert from "node:assert/strict";
import test from "node:test";

import { commandIdSchema, isJsonString } from "@chief/relay-contracts";

import { RelayClient } from "../src/relay-client";

void test("records privacy-safe onboarding events at the account relay boundary", async () => {
  let request: { path: string; body: unknown } | null = null;
  const client = new RelayClient({
    relayUrl: "https://relay.test",
    getAuthorization: () => Promise.resolve("Nostr signed-request"),
    fetch: (input, init) => {
      const url = new URL(
        isJsonString(input)
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url,
      );
      request = {
        path: url.pathname,
        body: isJsonString(init?.body) ? JSON.parse(init.body) : null,
      };
      return Promise.resolve(
        new Response(JSON.stringify({ accepted: true }), {
          headers: { "content-type": "application/json" },
        }),
      );
    },
  });

  await client.recordOnboardingEvent({
    sessionId: commandIdSchema.parse("21545a96-d835-4de6-858f-8a28eaada32f"),
    stage: "apps",
    event: "advanced",
    agentRuntime: "relay-cell",
    provider: "opencode",
    selectedAppCount: 2,
  });

  assert.deepEqual(request, {
    path: "/v1/onboarding/events",
    body: {
      sessionId: "21545a96-d835-4de6-858f-8a28eaada32f",
      stage: "apps",
      event: "advanced",
      agentRuntime: "relay-cell",
      provider: "opencode",
      selectedAppCount: 2,
    },
  });
});

void test("starts Eve workspace kickoff when the desktop enters the workspace", async () => {
  let path = "";
  const client = new RelayClient({
    relayUrl: "https://relay.test",
    workspaceId: "workspace-a",
    getAuthorization: () => Promise.resolve("Nostr signed-request"),
    fetch: (input) => {
      const url = new URL(
        isJsonString(input)
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url,
      );
      path = url.pathname;
      return Promise.resolve(
        new Response(JSON.stringify({ started: true }), {
          headers: { "content-type": "application/json" },
        }),
      );
    },
  });

  const result = await client.externalAgents.startWorkspaceKickoff();
  assert.equal(result.started, true);
  assert.equal(
    path,
    "/v1/workspaces/workspace-a/onboarding/start",
  );
});
