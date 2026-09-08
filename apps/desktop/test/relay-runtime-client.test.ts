import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers/promises";

import type { ServerMessage } from "@chief/agent-runtime/types";
import type { ConversationEvent } from "@chief/relay-contracts";
import { RelayClient } from "@chief/relay-client";
import {
  channelDetailSchema,
  channelMembershipSchema,
  channelRecordSchema,
  conversationEventSchema,
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

for (const chatId of ["channel:workspace-a:engineering", "on-device"]) {
  void test(`closing and reopening ${chatId} ignores stale loads and keeps live updates`, async (t) => {
    const relay = new RelayClient({
      relayUrl: "https://relay.test",
      workspaceId: snapshot.id,
    });
    const pending: {
      resolve: (page: Awaited<ReturnType<RelayClient["listMessages"]>>) => void;
      reject: (error: Error) => void;
    }[] = [];
    t.mock.method(
      relay,
      "listMessages",
      () => new Promise((resolve, reject) => pending.push({ resolve, reject })),
    );
    const close = t.mock.fn();
    const subscribe = t.mock.method(relay, "subscribeWorkspace", () =>
      Promise.resolve({
        close,
        cursor: () => 0,
        updateConversationIds: () => undefined,
      }),
    );
    const client = new RelayRuntimeClient(relay, snapshot);
    t.after(() => client.destroy());
    const events: ServerMessage[] = [];
    client.subscribe((event) => events.push(event));
    const scope = {
      chatId,
      workspaceId: snapshot.id,
      executorCapability: { apiBaseUrl: "http://127.0.0.1", token: "test" },
    };

    client.send({ type: "openChat", ...scope });
    client.send({ type: "closeChat", ...scope });
    client.send({ type: "openChat", ...scope });
    client.send({ type: "closeChat", ...scope });
    client.send({ type: "observeChat", ...scope });
    await setImmediate();
    assert.equal(pending.length, 3);
    pending[2]?.resolve({ messages: [], nextSequence: null });
    await setImmediate();
    assert.deepEqual(
      events.map((event) => event.type),
      ["chatOpened", "history"],
    );

    pending[0]?.reject(new Error("Old request failed after navigation"));
    pending[1]?.resolve({ messages: [], nextSequence: null });
    await setImmediate();
    assert.deepEqual(
      events.map((event) => event.type),
      ["chatOpened", "history"],
    );
    client.send({ type: "closeChat", ...scope });
    client.send({ type: "closeChat", ...scope });
    await setImmediate();
    assert.equal(events.filter((event) => event.type === "error").length, 0);
    assert.equal(subscribe.mock.callCount(), 1);
    assert.equal(close.mock.callCount(), 0);

    client.send({ type: "openChat", ...scope });
    await setImmediate();
    pending[3]?.reject(new Error("Current conversation failed to load"));
    await setImmediate();
    assert.deepEqual(events.at(-1), {
      type: "error",
      chatId,
      message: "Current conversation failed to load",
    });
  });
}

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
              principalId: "workspace-owner",
              role: "owner" as const,
              joinedAt: "2026-08-22T00:00:00.000Z",
              name: "Workspace",
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
          principalId: "workspace-owner",
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
    createNativeAgent() {
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
    listAgentJobs: () => Promise.resolve([]),
    listProjects() {
      throw new Error("not used in this test");
    },
    schedules: new RelayClient({
      relayUrl: "https://relay.test",
      workspaceId: "workspace-a",
    }).schedules,
    listProspects() {
      throw new Error("not used in this test");
    },
    listWorkspaceFiles() {
      throw new Error("not used in this test");
    },
    reactToMessage() {
      throw new Error("not used in this test");
    },
    removeAgent() {
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

void test("refreshes the sidebar channel roster when a live membership grant arrives", async () => {
  const unused = () => Promise.reject(new Error("not used in this test"));
  let onEvent: ((event: ConversationEvent) => void) | undefined;
  const missionControl = channelRecordSchema.parse({
    id: "mission-control",
    workspaceId: snapshot.id,
    name: "Mission Control",
    isPrivate: false,
    archived: false,
    createdAt: "2026-08-22T00:00:00.000Z",
  });
  const marketing = channelRecordSchema.parse({
    id: "marketing",
    workspaceId: snapshot.id,
    name: "Marketing",
    isPrivate: false,
    archived: false,
    createdAt: "2026-08-22T00:01:00.000Z",
  });
  let visible = [missionControl];
  const membershipsFor = (channels: typeof visible) =>
    channels.map((channel) =>
      channelMembershipSchema.parse({
        conversationId: channel.id,
        kind: "user",
        principalId: "workspace-owner",
        role: channel.id === "mission-control" ? "owner" : "member",
        joinedAt: "2026-08-22T00:00:00.000Z",
      }),
    );
  const relay = {
    createChannel: unused,
    listCurrentChannelMemberships() {
      return Promise.resolve(membershipsFor(visible));
    },
    activeWorkspace() {
      return Promise.resolve(snapshot);
    },
    subscribeWorkspace(
      input: Parameters<RelayRuntimeRelay["subscribeWorkspace"]>[0],
    ) {
      onEvent = input.onEvent;
      return Promise.resolve({
        close: () => undefined,
        cursor: () => 0,
        updateConversationIds: () => undefined,
      });
    },
    appendMessage: unused,
    createProject: unused,
    createNativeAgent: unused,
    listChannelMembers: unused,
    listChannelMemberships() {
      return Promise.resolve(membershipsFor(visible));
    },
    listChannels() {
      return Promise.resolve(visible);
    },
    listMessages: unused,
    loadAgentConfig: unused,
    listAgentJobs: () => Promise.resolve([]),
    listProjects: unused,
    schedules: new RelayClient({
      relayUrl: "https://relay.test",
      workspaceId: "workspace-a",
    }).schedules,
    listProspects: unused,
    listWorkspaceFiles: unused,
    reactToMessage: unused,
    removeAgent: unused,
    registerAgentKey: unused,
    saveAgentConfig: unused,
    startDirectMessage: unused,
    updateWorkspaceFile: unused,
  } satisfies RelayRuntimeRelay;
  const client = new RelayRuntimeClient(relay, snapshot);
  const roster = new Promise<Extract<ServerMessage, { type: "channels" }>>(
    (resolve) => {
      const seen: Extract<ServerMessage, { type: "channels" }>[] = [];
      client.subscribe((message) => {
        if (message.type !== "channels") return;
        seen.push(message);
        if (seen.length === 1) resolve(message);
      });
    },
  );
  const refreshed = new Promise<Extract<ServerMessage, { type: "channels" }>>(
    (resolve) => {
      let count = 0;
      client.subscribe((message) => {
        if (message.type !== "channels") return;
        count += 1;
        if (count === 2) resolve(message);
      });
    },
  );

  client.send({
    type: "listChannels",
    workspaceId: snapshot.id,
    executorCapability: { apiBaseUrl: "http://127.0.0.1", token: "test" },
  });

  const first = await roster;
  assert.deepEqual(
    first.channels.map((channel) => channel.id),
    ["mission-control"],
  );
  assert.ok(onEvent);

  visible = [missionControl, marketing];
  onEvent(
    conversationEventSchema.parse({
      eventId: crypto.randomUUID(),
      sequence: 1,
      protocolVersion: 1,
      workspaceId: snapshot.id,
      streamId: "conversation:marketing",
      type: "conversation.message.appended",
      actor: {
        kind: "agent",
        agentId: "chief",
        pubkey: "a".repeat(64),
        workspaceId: snapshot.id,
        role: "member",
      },
      occurredAt: "2026-08-22T00:01:00.000Z",
      payload: {
        message: {
          id: crypto.randomUUID(),
          workspaceId: snapshot.id,
          conversationId: "marketing",
          body: "Chief added Workspace to the channel.",
          author: { kind: "system", id: "relay" },
          createdAt: "2026-08-22T00:01:00.000Z",
          sequence: 1,
          mentions: [],
          components: [
            {
              id: "membership-1",
              kind: "channel-action",
              version: 1,
              payload: {
                type: "member-added",
                actorId: "chief",
                actorName: "Chief",
                actorType: "agent",
                targetId: "workspace-owner",
                targetKind: "user",
                targetName: "Workspace",
                targetIds: "workspace-owner",
                targetNames: "Workspace",
                agentIds: "",
                userIds: "workspace-owner",
              },
            },
          ],
          reactions: [],
          edited: false,
          deleted: false,
        },
      },
    }),
  );

  const next = await refreshed;
  assert.deepEqual(
    next.channels.map((channel) => channel.id),
    ["mission-control", "marketing"],
  );
  assert.ok(
    next.channels
      .find((channel) => channel.id === "marketing")
      ?.userIds.includes("workspace-owner"),
  );
  client.destroy();
});
