import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { JsonValue } from "@chief/relay-contracts";

import type { ChannelEvent, WorkspaceChannel } from "../src/channel-types.js";
import { handleChannelLocalTool } from "../src/channel-local-tools.js";
import { LocalStore } from "../src/local-store.js";

process.env.CHIEF_DATABASE_ENCRYPTION_KEY =
  "chief-channel-message-mentions-test-key";

function request(path: string, body: JsonValue) {
  return new Request(`http://127.0.0.1:4318${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

void test("a visible agent mention becomes a durable wake signal", async () => {
  const directory = mkdtempSync(join(tmpdir(), "chief-channel-mention-"));
  const store = new LocalStore(join(directory, "chief.sqlite"));
  const wakeups: string[][] = [];
  const context = {
    actor: { type: "agent" as const, id: "chief", name: "Chief" },
    channelStore: store.channelStore(),
    availableAgentIds: ["chief", "engineer"],
    onAgentMentions: (
      _channel: WorkspaceChannel,
      _event: ChannelEvent,
      agentIds: readonly string[],
    ) => {
      wakeups.push([...agentIds]);
    },
  };
  try {
    const createBody = {
      name: "Engineering handoff",
      operationKey: "engineering-handoff-test",
      kind: "feature",
      members: [{ type: "agent", id: "engineer" }],
    };
    const created = await handleChannelLocalTool(
      request("/local-tools/channels", createBody),
      "workspace-a",
      createBody,
      context,
    );
    const channelId = (created.value as { channel: { id: string } }).channel.id;
    const body = { content: "@Engineer please start this scoped build." };
    const posted = await handleChannelLocalTool(
      request(`/local-tools/channels/${channelId}/messages`, body),
      "workspace-a",
      body,
      context,
    );
    const event = (posted.value as { event: ChannelEvent }).event;

    assert.deepEqual(wakeups, [["engineer"]]);
    assert.equal(event.tags.filter((tag) => tag[0] === "p").length, 1);
  } finally {
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
