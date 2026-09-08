import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { JsonValue } from "@chief/relay-contracts";

import type { ChannelEvent } from "../src/channel-types.js";
import { handleChannelLocalTool } from "../src/channel-local-tools.js";
import { LocalStore } from "../src/local-store.js";

process.env.CHIEF_DATABASE_ENCRYPTION_KEY =
  "chief-channel-project-recommendation-test-key";

function request(path: string, body: JsonValue) {
  return new Request(`http://127.0.0.1:4318${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

void test("project recommendations publish a durable connect card", async () => {
  const directory = mkdtempSync(join(tmpdir(), "chief-project-recommend-"));
  const store = new LocalStore(join(directory, "chief.sqlite"));
  const published: ChannelEvent[] = [];
  const context = {
    actor: { type: "agent" as const, id: "engineer", name: "Engineer" },
    channelStore: store.channelStore(),
    availableAgentIds: ["chief", "engineer"],
    onChannelEvent: (event: ChannelEvent) => {
      published.push(event);
    },
  };
  try {
    const engineering = (await context.channelStore.list("workspace-a")).find(
      (channel) => channel.slug === "engineering",
    );
    assert.ok(engineering);
    const body = {
      content: "Connect the product repository to continue.",
      remoteUrl: "https://github.com/acme/program.git",
      idempotencyKey: "engineering-connect-repo",
    };
    const first = await handleChannelLocalTool(
      request(
        `/local-tools/channels/${engineering.id}/projects/recommend`,
        body,
      ),
      "workspace-a",
      body,
      context,
    );
    const second = await handleChannelLocalTool(
      request(
        `/local-tools/channels/${engineering.id}/projects/recommend`,
        body,
      ),
      "workspace-a",
      body,
      context,
    );
    const result = first.value as {
      event: Extract<ChannelEvent, { kind: 9 }>;
    };
    assert.deepEqual(result.event.parts, [
      {
        type: "data-project-recommendation",
        data: {
          title: "Connect a repository",
          description: "Add the Git repository this workspace should work in.",
          remoteUrl: "https://github.com/acme/program.git",
        },
      },
    ]);
    assert.equal(
      (second.value as { event: ChannelEvent }).event.id,
      result.event.id,
    );
    assert.equal(published.length, 1);
  } finally {
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
