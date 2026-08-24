import assert from "node:assert/strict";
import test from "node:test";

import type { ServerMessage } from "@chief/agent-runtime/types";
import type { RelayClient } from "@chief/relay-client";
import type { WorkspaceSnapshot } from "@chief/relay-contracts";

import { RelayRuntimeClient } from "../src/lib/relay-runtime-client.ts";

const snapshot = {
  id: "workspace-a",
  name: "Acme",
  conversations: [],
  agents: [],
} as unknown as WorkspaceSnapshot;

void test("routes createChannel through the relay and emits the created channel", async () => {
  let createInput:
    { conversationId: string; name: string; isPrivate?: boolean } | undefined;
  const relay = {
    createChannel(input: typeof createInput) {
      assert.ok(input);
      createInput = input;
      return Promise.resolve({
        channel: {
          id: input.conversationId,
          workspaceId: snapshot.id,
          name: input.name,
          isPrivate: false,
          archived: false,
          createdAt: "2026-08-22T00:00:00.000Z",
        },
        members: [
          {
            kind: "user" as const,
            principalId: "daniel",
            role: "owner" as const,
            joinedAt: "2026-08-22T00:00:00.000Z",
            name: "Daniel",
          },
        ],
      });
    },
    listCurrentChannelMemberships() {
      assert.ok(createInput);
      return Promise.resolve([
        {
          conversationId: createInput.conversationId,
          kind: "user" as const,
          principalId: "daniel",
          role: "owner" as const,
          joinedAt: "2026-08-22T00:00:00.000Z",
        },
      ]);
    },
    activeWorkspace() {
      return Promise.resolve(snapshot);
    },
    subscribeWorkspace() {
      return Promise.resolve({
        close: () => undefined,
        updateConversationIds: () => undefined,
      });
    },
  } as unknown as RelayClient;
  const client = new RelayRuntimeClient(relay, snapshot);
  const created = new Promise<
    Extract<ServerMessage, { type: "channelCreated" }>
  >((resolve) => {
    client.subscribe((message) => {
      if (message.type === "channelCreated") resolve(message);
    });
  });

  client.send({
    type: "createChannel",
    requestId: "request-1",
    workspaceId: snapshot.id,
    name: "  Launch room  ",
    executorCapability: { apiBaseUrl: "http://127.0.0.1", token: "test" },
  });

  const message = await created;
  assert.ok(createInput);
  assert.match(createInput.conversationId, /^[0-9a-f-]{36}$/u);
  assert.equal(createInput.name, "Launch room");
  assert.equal(message.requestId, "request-1");
  assert.equal(message.channel.id, createInput.conversationId);
  assert.equal(message.channel.name, "Launch room");
  assert.deepEqual(message.channel.userIds, ["workspace-owner"]);
  client.destroy();
});
