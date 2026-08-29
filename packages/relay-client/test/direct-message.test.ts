import assert from "node:assert/strict";
import test from "node:test";

import {
  agentIdSchema,
  directStartCommandSchema,
  isJsonString,
} from "@chief/relay-contracts";

import { RelayClient } from "../src/relay-client";

void test("starts a direct message using the versioned command envelope", async () => {
  let requestBody:
    ReturnType<typeof directStartCommandSchema.parse> | undefined;
  const client = new RelayClient({
    relayUrl: "https://relay.test",
    workspaceId: "workspace-a",
    getAuthorization: () => Promise.resolve("Nostr signed-request"),
    fetch: (_input, init) => {
      requestBody = isJsonString(init?.body)
        ? directStartCommandSchema.parse(JSON.parse(init.body))
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
  assert.ok(requestBody);
  assert.deepEqual(requestBody, {
    commandId: requestBody.commandId,
    protocolVersion: 1,
    occurredAt: requestBody.occurredAt,
    payload: {
      participant: { kind: "agent", principalId: "setup" },
    },
  });
  assert.match(requestBody.commandId, /^[0-9a-f-]{36}$/u);
  assert.equal(Number.isNaN(Date.parse(requestBody.occurredAt)), false);
});
