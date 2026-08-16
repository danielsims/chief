import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { AgentEvent, ServerMessage } from "../src/types.js";
import {
  channelChatId,
  channelIdFromChatId,
  createChannelEvent,
  createChannelReaction,
} from "../src/channels/nip29.js";
import {
  channelMessageCoordinates,
  channelPublicationInstructions,
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

void test("shared channel publication names its exact destination", () => {
  const instructions = channelPublicationInstructions(
    "channel-a",
    "thread-root-a",
  );
  assert.match(instructions, /ordinary assistant text is private/u);
  assert.match(instructions, /localTools\.channelsMessagesPost/u);
  assert.match(instructions, /channelId "channel-a"/u);
  assert.match(instructions, /threadRootId "thread-root-a"/u);
  assert.match(instructions, /Do not publish tool narration/u);
});

void test("current message coordinates are supplied without duplicating policy", () => {
  assert.equal(
    channelMessageCoordinates("channel-a", "message-a"),
    'Current channel message coordinates: channelId "channel-a", messageId "message-a".',
  );
});

void test("explicitly mirrored messages keep thread tags", async () => {
  const directory = mkdtempSync(join(tmpdir(), "chief-mirror-"));
  try {
    const store = new LocalStore(join(directory, "chief.sqlite"));
    const manager = new SessionManager(store);
    const channel = (await store.channelStore().list("workspace-a")).find(
      (candidate) => candidate.slug === "general",
    );
    assert.ok(channel);
    const chatId = channelChatId("workspace-a", channel.id);
    const sent: ServerMessage[] = [];
    const send = (message: ServerMessage) => sent.push(message);

    const first = {
      type: "message",
      id: "assistant-1",
      role: "assistant",
      threadRootId: "root-message",
      content: [{ type: "text", text: "I’ll check the project first." }],
    } satisfies AgentEvent;
    const second = {
      type: "message",
      id: "assistant-2",
      role: "assistant",
      threadRootId: "root-message",
      content: [{ type: "text", text: "Opening the browser for you." }],
    } satisfies AgentEvent;

    const eventA = await mirrorEvent(
      manager,
      send,
      "workspace-a",
      chatId,
      first,
      channel.id,
      { id: "chief", name: "Chief" },
    );
    const eventB = await mirrorEvent(
      manager,
      send,
      "workspace-a",
      chatId,
      second,
      channel.id,
      { id: "chief", name: "Chief" },
    );

    assert.ok(eventA);
    assert.ok(eventB);
    assert.notEqual(
      eventA.id,
      eventB.id,
      "each message mirrors as its own event",
    );
    for (const event of [eventA, eventB]) {
      assert.ok(
        event.tags.some((tag) => tag[0] === "h" && tag[1] === channel.id),
        "channel tag",
      );
      assert.ok(
        event.tags.some(
          (tag) =>
            tag[0] === "e" && tag[1] === "root-message" && tag[3] === "root",
        ),
        "thread root tag preserved",
      );
      assert.ok(
        event.tags.some(
          (tag) =>
            tag[0] === "client" &&
            (tag[1] === "assistant-1" || tag[1] === "assistant-2"),
        ),
        "source message id tag",
      );
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
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
      // prettier-ignore
      ["mission-control", "engineering", "analytics", "advertising", "prospecting", "marketing", "general"],
    );
    assert.deepEqual(
      channels
        .filter((channel) => channel.visibility === "private")
        .map((channel) => channel.slug),
      [],
    );
    assert.equal(
      channels.filter((channel) => channel.visibility === "direct").length,
      8,
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
    assert.deepEqual(updated.agentIds, ["chief", "analyst", "ads"]);
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

void test("a workspace retains mission control when other channels are removed", async () => {
  const directory = mkdtempSync(join(tmpdir(), "chief-channel-last-"));
  const store = new LocalStore(join(directory, "chief.sqlite"));
  try {
    const publicChannels = (
      await store.channelStore().list("workspace-a")
    ).filter((channel) => channel.visibility === "public");
    for (const channel of publicChannels.filter(
      (candidate) => candidate.slug !== "mission-control",
    )) {
      await store.channelStore().remove("workspace-a", channel.id);
    }
    assert.deepEqual(
      (await store.channelStore().list("workspace-a"))
        .filter((channel) => channel.visibility === "public")
        .map((channel) => channel.slug),
      ["mission-control"],
    );
  } finally {
    await store.close();
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
      actor: { type: "agent", id: "chief", name: "Chief" },
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
