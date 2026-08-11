import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { ChannelEvent } from "../src/channel-types.js";
import { handleChannelLocalTool } from "../src/channel-local-tools.js";
import { LocalStore } from "../src/local-store.js";

process.env.CHIEF_DATABASE_ENCRYPTION_KEY =
  "chief-channel-mention-test-encryption-key";

function post(path: string, body: unknown) {
  return new Request(`http://127.0.0.1:4318${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

void test("mentioning an agent adds them before publishing the thread root", async () => {
  const directory = mkdtempSync(join(tmpdir(), "chief-channel-mention-"));
  const store = new LocalStore(join(directory, "chief.sqlite"));
  const events: ChannelEvent[] = [];
  let channelsChanged = 0;
  const context = {
    actor: { type: "agent" as const, id: "chief", name: "Chief" },
    channelStore: store.channelStore(),
    availableAgentIds: ["chief", "brand", "setup"],
    onChannelEvent: (event: ChannelEvent) => {
      events.push(event);
    },
    onChannelsChanged: () => {
      channelsChanged += 1;
    },
  };
  try {
    const createBody = {
      name: "Brand launch",
      operationKey: "mission-control-mention-test",
    };
    const created = await handleChannelLocalTool(
      post("/local-tools/channels", createBody),
      "workspace-a",
      createBody,
      context,
    );
    const channel = (created.value as { channel: { id: string } }).channel;
    events.length = 0;
    channelsChanged = 0;
    const body = {
      content: "@Marketer, build our working brand profile.",
      mentions: ["brand"],
      idempotencyKey: "onboarding-brand-thread",
    };
    await handleChannelLocalTool(
      post(`/local-tools/channels/${channel.id}/messages`, body),
      "workspace-a",
      body,
      context,
    );

    const updated = await store.channelStore().get("workspace-a", channel.id);
    assert.ok(updated);
    assert.ok(updated.agentIds.includes("brand"));
    assert.equal(channelsChanged, 1);
    assert.equal(events.length, 2);
    assert.equal(events[0]?.content, "Chief added Marketer to the channel.");
    assert.equal(events[1]?.content, body.content);
    const postedEvent = events[1];
    assert.ok(postedEvent);
    assert.equal(postedEvent.tags.filter((tag) => tag[0] === "p").length, 1);

    await handleChannelLocalTool(
      post(`/local-tools/channels/${channel.id}/messages`, body),
      "workspace-a",
      body,
      context,
    );
    assert.equal(events.length, 2);
    assert.equal(channelsChanged, 1);
  } finally {
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
