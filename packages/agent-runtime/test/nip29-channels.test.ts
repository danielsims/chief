import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { ChannelEvent } from "../src/channel-types.js";
import type { AgentEvent, ServerMessage } from "../src/types.js";
import {
  channelChatId,
  channelIdFromChatId,
  createChannelEvent,
  createChannelReaction,
} from "../src/channels/nip29.js";
import {
  advanceChannelTurnMirror,
  beginAgentActivityReaction,
  endAgentActivityReaction,
  isUserFacingChannelMessage,
  mirrorEvent,
} from "../src/channels/server-bridge.js";
import { LocalStore } from "../src/local-store.js";
import { SessionManager } from "../src/manager.js";

process.env.CHIEF_DATABASE_ENCRYPTION_KEY =
  "chief-nip29-channel-integration-test-key";

void test("channel conversations are stable and isolated by workspace", () => {
  const channelId = "channel-a";
  const first = channelChatId("workspace-a", channelId);
  const second = channelChatId("workspace-b", channelId);
  assert.notEqual(first, second);
  assert.equal(channelIdFromChatId(first), channelId);
  assert.equal(channelIdFromChatId(`channel:${channelId}`), channelId);
});

void test("only a completed user-facing agent reply is mirrored", () => {
  const progress = {
    type: "message",
    role: "assistant",
    content: [{ type: "text", text: "I’m checking that now." }],
  } satisfies AgentEvent;
  const activity = {
    type: "message",
    role: "assistant",
    content: [{ type: "tool_use", id: "tool-1", name: "search", input: {} }],
  } satisfies AgentEvent;
  const finalReply = {
    type: "message",
    id: "final-reply",
    role: "assistant",
    content: [{ type: "text", text: "The report is ready." }],
  } satisfies AgentEvent;

  assert.equal(isUserFacingChannelMessage(activity), false);
  assert.equal(isUserFacingChannelMessage(finalReply), true);

  const state = { terminal: false };
  let transition = advanceChannelTurnMirror(state, activity);
  assert.equal(transition.schedule, false);
  assert.equal(transition.state.pending, undefined);

  transition = advanceChannelTurnMirror(transition.state, progress);
  assert.equal(transition.schedule, false);
  assert.equal(transition.state.pending, progress);

  transition = advanceChannelTurnMirror(transition.state, finalReply);
  assert.equal(transition.schedule, false);
  assert.equal(transition.state.pending, finalReply);

  transition = advanceChannelTurnMirror(transition.state, {
    type: "result",
    ok: true,
  });
  assert.equal(transition.schedule, true);
  assert.equal(transition.state.pending, finalReply);

  transition = advanceChannelTurnMirror(transition.state, {
    type: "message",
    role: "user",
    content: [{ type: "text", text: "Next request" }],
  });
  assert.deepEqual(transition.state, { terminal: false });
  assert.equal(transition.schedule, false);
});

void test("workspace channels are durable NIP-29 groups instead of chat labels", async () => {
  const directory = mkdtempSync(join(tmpdir(), "chief-channels-"));
  try {
    const store = new LocalStore(join(directory, "chief.sqlite"));
    const channelStore = store.channelStore();
    assert.equal(channelStore, store.channelStore());
    const channelLists = await Promise.all(
      Array.from({ length: 12 }, () => channelStore.list("workspace-a")),
    );
    const channels = channelLists[0] ?? [];
    assert.ok(channelLists.every((list) => list.length === channels.length));
    assert.deepEqual(
      channels
        .filter((channel) => channel.visibility === "public")
        .map((channel) => channel.slug),
      ["analytics", "advertising", "prospecting", "general"],
    );
    assert.deepEqual(
      channels
        .filter((channel) => channel.visibility === "private")
        .map((channel) => channel.slug),
      ["getting-started"],
    );
    assert.equal(
      channels.filter((channel) => channel.visibility === "direct").length,
      7,
    );
    assert.equal(
      new Set(
        channels.map((channel) => channelChatId("workspace-a", channel.id)),
      ).size,
      channels.length,
    );
    const analytics = channels.find((channel) => channel.slug === "analytics");
    assert.ok(analytics);
    const updated = await store
      .channelStore()
      .addAgents("workspace-a", analytics.id, ["ads", "analyst"]);
    assert.ok(updated);
    assert.deepEqual(updated.agentIds, ["cmo", "analyst", "ads"]);
    const reassigned = await store
      .channelStore()
      .setAgents("workspace-a", analytics.id, ["analyst", "brand"]);
    assert.ok(reassigned);
    assert.deepEqual(reassigned.agentIds, ["analyst", "brand"]);
    assert.deepEqual(
      (await store.channelStore().get("workspace-a", analytics.id))?.agentIds,
      ["analyst", "brand"],
    );
    const created = await store.channelStore().create("workspace-a", {
      name: "Launch planning",
      description: "Coordinate the August release",
    });
    const duplicate = await store.channelStore().create("workspace-a", {
      name: "Launch planning",
    });
    assert.equal(created.slug, "launch-planning");
    assert.equal(duplicate.slug, "launch-planning-2");
    assert.equal(created.visibility, "public");
    const renamed = await store
      .channelStore()
      .update("workspace-a", created.id, {
        name: "August launch",
        topic: "Coordinate the launch",
        description: "New positioning and release plan",
      });
    assert.equal(renamed.name, "August launch");
    assert.equal(renamed.topic, "Coordinate the launch");
    assert.equal(renamed.description, "New positioning and release plan");
    assert.equal(renamed.slug, "launch-planning");
    assert.equal(
      (await store.channelStore().get("workspace-a", created.id))?.name,
      "August launch",
    );
    await assert.rejects(
      store.channelStore().update("workspace-a", created.id, {
        name: " ",
        topic: "",
        description: "",
      }),
      /Channel name is required/u,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

void test("deleting a channel removes its Nostr history and stays deleted", async () => {
  const directory = mkdtempSync(join(tmpdir(), "chief-channel-delete-"));
  const databasePath = join(directory, "chief.sqlite");
  let store = new LocalStore(databasePath);
  try {
    const channels = await store.channelStore().list("workspace-a");
    const channel = channels.find(
      (candidate) => candidate.slug === "analytics",
    );
    const directMessage = channels.find(
      (candidate) => candidate.visibility === "direct",
    );
    assert.ok(channel);
    assert.ok(directMessage);
    const message = createChannelEvent({
      workspaceId: "workspace-a",
      channelId: channel.id,
      actor: { type: "user", id: "owner", name: "Daniel" },
      content: "Delete this with the channel.",
    });
    await store.channelStore().appendEvent("workspace-a", message);
    await store.channelStore().appendEvent(
      "workspace-a",
      createChannelReaction({
        workspaceId: "workspace-a",
        channelId: channel.id,
        targetEventId: message.id,
        actor: { type: "user", id: "owner", name: "Daniel" },
        reaction: "👍",
      }),
    );

    await store.channelStore().remove("workspace-a", channel.id);
    assert.equal(
      await store.channelStore().get("workspace-a", channel.id),
      undefined,
    );
    assert.deepEqual(
      await store.channelStore().events("workspace-a", channel.id),
      [],
    );
    await assert.rejects(
      store.channelStore().remove("workspace-a", directMessage.id),
      /Direct messages cannot be deleted/u,
    );

    await store.close();
    store = new LocalStore(databasePath);
    assert.equal(
      (await store.channelStore().list("workspace-a")).some(
        (candidate) => candidate.slug === "analytics",
      ),
      false,
    );
  } finally {
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

void test("a workspace keeps at least one public channel", async () => {
  const directory = mkdtempSync(join(tmpdir(), "chief-channel-last-"));
  const store = new LocalStore(join(directory, "chief.sqlite"));
  try {
    const publicChannels = (
      await store.channelStore().list("workspace-a")
    ).filter((channel) => channel.visibility === "public");
    for (const channel of publicChannels.slice(1)) {
      await store.channelStore().remove("workspace-a", channel.id);
    }
    const finalChannel = publicChannels[0];
    assert.ok(finalChannel);
    await assert.rejects(
      store.channelStore().remove("workspace-a", finalChannel.id),
      /must keep at least one channel/u,
    );
  } finally {
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

void test("agent activity reactions wrap one idempotent channel message", async () => {
  const directory = mkdtempSync(join(tmpdir(), "chief-agent-activity-"));
  const store = new LocalStore(join(directory, "chief.sqlite"));
  const manager = new SessionManager(store);
  try {
    const channel = (await store.channelStore().list("workspace-a")).find(
      (candidate) => candidate.slug === "general",
    );
    assert.ok(channel);
    const sent: ServerMessage[] = [];
    const broadcasted: ServerMessage[] = [];
    const send = (message: ServerMessage) => sent.push(message);
    const broadcast = (workspaceId: string, event: ChannelEvent) => {
      broadcasted.push({ type: "channelEvent", workspaceId, event });
    };
    const input = {
      type: "message" as const,
      id: "mention-message",
      role: "user" as const,
      content: [{ type: "text" as const, text: "@Advertising help" }],
      mentions: ["ads"],
    };

    const first = await mirrorEvent(
      manager,
      send,
      "workspace-a",
      channelChatId("workspace-a", channel.id),
      input,
      channel.id,
      undefined,
      broadcast,
    );
    const second = await mirrorEvent(
      manager,
      send,
      "workspace-a",
      channelChatId("workspace-a", channel.id),
      input,
      channel.id,
    );
    assert.ok(first);
    assert.equal(second?.id, first.id);
    assert.equal(
      broadcasted.filter((message) => message.type === "channelEvent").length,
      1,
    );

    const reactionId = await beginAgentActivityReaction(
      manager,
      send,
      "workspace-a",
      channel.id,
      first.id,
      { id: "ads", name: "Advertising" },
    );
    let events = await store.channelStore().events("workspace-a", channel.id);
    assert.equal(events.filter((event) => event.kind === 9).length, 1);
    const reaction = events.find((event) => event.id === reactionId);
    assert.ok(reaction);
    assert.equal(reaction.kind, 7);
    assert.equal(reaction.content, "👀");
    assert.equal(reaction.actor.id, "ads");

    await endAgentActivityReaction(
      manager,
      send,
      "workspace-a",
      channel.id,
      reactionId,
    );
    events = await store.channelStore().events("workspace-a", channel.id);
    assert.equal(
      events.some((event) => event.id === reactionId),
      false,
    );
    assert.ok(sent.some((message) => message.type === "channelEvents"));
  } finally {
    await manager.stopAll();
    rmSync(directory, { recursive: true, force: true });
  }
});

void test("thread replies and explicit recipients use interoperable Nostr tags", () => {
  const event = createChannelEvent({
    workspaceId: "workspace-a",
    channelId: "channel-a",
    actor: { type: "user", id: "owner", name: "Daniel" },
    content: "@Analyst can you verify this?",
    mentions: ["analyst"],
    threadRootId: "root-event",
    sourceId: "reply-event",
  });

  assert.deepEqual(event.tags[0], ["h", "channel-a"]);
  assert.equal(event.tags[1]?.[0], "p");
  const recipient = event.tags[1];
  assert.ok(recipient);
  assert.match(recipient[1] ?? "", /^[a-f0-9]{64}$/);
  assert.deepEqual(event.tags.slice(2), [
    ["e", "root-event", "", "root"],
    ["e", "root-event", "", "reply"],
    ["client", "reply-event"],
  ]);
});

void test("channel membership broadcasts use durable action tags", () => {
  const event = createChannelEvent({
    workspaceId: "workspace-a",
    channelId: "channel-a",
    actor: { type: "user", id: "owner", name: "Daniel Sims" },
    content: "Daniel Sims added Analyst to the channel.",
    mentions: ["analyst"],
    channelAction: { type: "member-added", agentIds: ["analyst"] },
    sourceId: "membership-event",
  });

  assert.ok(
    event.tags.some((tag) => tag[0] === "action" && tag[1] === "member-added"),
  );
  assert.ok(
    event.tags.some((tag) => tag[0] === "agent" && tag[1] === "analyst"),
  );
});

void test("channel messages persist as kind-9 events scoped with h tags", async () => {
  const directory = mkdtempSync(join(tmpdir(), "chief-channel-events-"));
  try {
    const store = new LocalStore(join(directory, "chief.sqlite"));
    const [channel] = await store.channelStore().list("workspace-a");
    assert.ok(channel);
    const event = createChannelEvent({
      workspaceId: "workspace-a",
      channelId: channel.id,
      actor: { type: "agent", id: "analyst", name: "Analyst" },
      content: "The weekly acquisition report is ready.",
      sourceId: "agent-message-1",
    });
    await store.channelStore().appendEvent("workspace-a", event);
    await store.channelStore().appendEvent("workspace-a", event);

    const events = await store.channelStore().events("workspace-a", channel.id);
    assert.equal(events.length, 1);
    const firstEvent = events[0];
    if (!firstEvent) assert.fail("Expected the stored channel event.");
    assert.equal(firstEvent.kind, 9);
    assert.deepEqual(firstEvent.tags[0], ["h", channel.id]);
    assert.equal(firstEvent.actor.id, "analyst");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

void test("channel reactions persist as kind-7 events targeting a message", async () => {
  const directory = mkdtempSync(join(tmpdir(), "chief-channel-reactions-"));
  try {
    const store = new LocalStore(join(directory, "chief.sqlite"));
    const [channel] = await store.channelStore().list("workspace-a");
    assert.ok(channel);
    const message = createChannelEvent({
      workspaceId: "workspace-a",
      channelId: channel.id,
      actor: { type: "agent", id: "cmo", name: "Chief" },
      content: "The launch plan is ready.",
      sourceId: "message-1",
    });
    const reaction = createChannelReaction({
      workspaceId: "workspace-a",
      channelId: channel.id,
      targetEventId: message.id,
      actor: { type: "user", id: "workspace-owner", name: "Daniel" },
      reaction: "👍",
    });
    await store.channelStore().appendEvent("workspace-a", message);
    await store.channelStore().appendEvent("workspace-a", reaction);

    const events = await store.channelStore().events("workspace-a", channel.id);
    assert.equal(events.length, 2);
    const storedReaction = events.find((event) => event.kind === 7);
    assert.ok(storedReaction);
    assert.equal(storedReaction.content, "👍");
    assert.deepEqual(storedReaction.tags, [
      ["h", channel.id],
      ["e", message.id, "", "reply"],
    ]);

    await store.channelStore().removeEvent("workspace-a", reaction.id);
    assert.deepEqual(
      (await store.channelStore().events("workspace-a", channel.id)).map(
        (event) => event.kind,
      ),
      [9],
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
