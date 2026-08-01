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
      channels.map((channel) => channel.slug),
      ["analytics", "advertising", "prospecting", "general"],
    );
    assert.deepEqual(
      channels.map((channel) => channel.protocol),
      ["nip29", "nip29", "nip29", "nip29"],
    );
    assert.equal(
      new Set(channels.map((channel) => channelChatId(channel.id))).size,
      channels.length,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
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
