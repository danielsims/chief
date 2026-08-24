import assert from "node:assert/strict";
import test from "node:test";

import { agentIdSchema, isJsonString } from "@chief/relay-contracts";

import { RelayClient } from "../src/relay-client";

void test("starts a direct message using the versioned command envelope", async () => {
  let requestBody: unknown;
  const client = new RelayClient({
    relayUrl: "https://relay.test",
    workspaceId: "workspace-a",
    getAuthorization: () => Promise.resolve("Nostr signed-request"),
    fetch: (_input, init) => {
      requestBody = isJsonString(init?.body)
        ? JSON.parse(init.body)
        : undefined;
      return Promise.resolve(
        Response.json({
          conversation: {
            id: "direct-user-a-setup",
            name: "Setup",
            kind: "direct",
            isPrivate: true,
            archived: false,
            unreadCount: 0,
            requiresAttention: false,
            lastMessage: null,
          },
        }),
      );
    },
  });

  const result = await client.startDirectMessage({
    kind: "agent",
    principalId: agentIdSchema.parse("setup"),
  });

  assert.equal(result.conversation.id, "direct-user-a-setup");
  assert.deepEqual(requestBody, {
    commandId: (requestBody as { commandId: string }).commandId,
    protocolVersion: 1,
    occurredAt: (requestBody as { occurredAt: string }).occurredAt,
    payload: {
      participant: { kind: "agent", principalId: "setup" },
    },
  });
  assert.match(
    (requestBody as { commandId: string }).commandId,
    /^[0-9a-f-]{36}$/u,
  );
  assert.equal(
    Number.isNaN(
      Date.parse((requestBody as { occurredAt: string }).occurredAt),
    ),
    false,
  );
});
