import assert from "node:assert/strict";
import test from "node:test";

import type { ServerMessage } from "@chief/agent-runtime/types";
import {
  channelDetailSchema,
  channelMembershipSchema,
  workspaceSnapshotSchema,
} from "@chief/relay-contracts";

import type { RelayRuntimeRelay } from "../src/lib/relay-runtime-relay.ts";
import { RelayRuntimeClient } from "../src/lib/relay-runtime-client.ts";

const snapshot = workspaceSnapshotSchema.parse({
  id: "workspace-a",
  name: "Acme",
  website: "",
  selectedApps: [],
  runtime: "cloud",
  imageURL: null,
  onboardingComplete: true,
  conversations: [],
  agents: [],
  projects: [],
  createdAt: "2026-08-22T00:00:00.000Z",
});

void test("routes createChannel through the relay and emits the created channel", async () => {
  let createInput:
    { conversationId: string; name: string; isPrivate?: boolean } | undefined;
  const relay = {
    createChannel(input: Parameters<RelayRuntimeRelay["createChannel"]>[0]) {
      createInput = input;
      return Promise.resolve(
        channelDetailSchema.parse({
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
        }),
      );
    },
    listCurrentChannelMemberships() {
      assert.ok(createInput);
      return Promise.resolve([
        channelMembershipSchema.parse({
          conversationId: createInput.conversationId,
          kind: "user",
          principalId: "daniel",
          role: "owner",
          joinedAt: "2026-08-22T00:00:00.000Z",
        }),
      ]);
    },
    activeWorkspace() {
      return Promise.resolve(snapshot);
    },
    subscribeWorkspace() {
      return Promise.resolve({
        close: () => undefined,
        cursor: () => 0,
        updateConversationIds: () => undefined,
      });
    },
    appendMessage() {
      throw new Error("not used in this test");
    },
    createProject() {
      throw new Error("not used in this test");
    },
    listChannelMembers() {
      throw new Error("not used in this test");
    },
    listChannelMemberships() {
      throw new Error("not used in this test");
    },
    listChannels() {
      throw new Error("not used in this test");
    },
    listMessages() {
      throw new Error("not used in this test");
    },
    loadAgentConfig() {
      throw new Error("not used in this test");
    },
    listProjects() {
      throw new Error("not used in this test");
    },
    listProspects() {
      throw new Error("not used in this test");
    },
    listWorkspaceFiles() {
      throw new Error("not used in this test");
    },
    reactToMessage() {
      throw new Error("not used in this test");
    },
    registerAgentKey() {
      throw new Error("not used in this test");
    },
    saveAgentConfig() {
      throw new Error("not used in this test");
    },
    startDirectMessage() {
      throw new Error("not used in this test");
    },
    updateWorkspaceFile() {
      throw new Error("not used in this test");
    },
  } satisfies RelayRuntimeRelay;
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
