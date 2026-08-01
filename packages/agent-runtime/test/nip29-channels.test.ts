import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { channelChatId, createChannelEvent } from "../src/channels/nip29.js";
import { LocalStore } from "../src/local-store.js";

process.env.CHIEF_DATABASE_ENCRYPTION_KEY =
  "chief-nip29-channel-integration-test-key";

void test("workspace channels are durable NIP-29 groups instead of chat labels", async () => {
  const directory = mkdtempSync(join(tmpdir(), "chief-channels-"));
  try {
    const store = new LocalStore(join(directory, "chief.sqlite"));
    const channels = await store.channelStore().list("workspace-a");
    assert.deepEqual(
      channels
        .filter((channel) => channel.visibility !== "direct")
        .map((channel) => channel.slug),
      ["analytics", "advertising", "prospecting", "general"],
    );
    assert.equal(
      channels.filter((channel) => channel.visibility === "direct").length,
      7,
    );
    assert.equal(
      new Set(channels.map((channel) => channelChatId(channel.id))).size,
      channels.length,
    );
    const analytics = channels.find((channel) => channel.slug === "analytics");
    assert.ok(analytics);
    const updated = await store
      .channelStore()
      .addAgents("workspace-a", analytics.id, ["ads", "analyst"]);
    assert.ok(updated);
    assert.deepEqual(updated.agentIds, ["cmo", "analyst", "ads"]);
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
  } finally {
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
