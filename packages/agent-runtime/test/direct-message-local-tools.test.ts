import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { handleChannelLocalTool } from "../src/channel-local-tools.js";
import { LocalStore } from "../src/local-store.js";

process.env.CHIEF_DATABASE_ENCRYPTION_KEY =
  "chief-direct-message-local-tools-test-key";

void test("a Setup agent can post inside its private direct conversation", async () => {
  const directory = mkdtempSync(join(tmpdir(), "chief-setup-dm-tools-"));
  const store = new LocalStore(join(directory, "chief.sqlite"));
  const context = {
    actor: { type: "agent" as const, id: "setup", name: "Setup" },
    channelStore: store.channelStore(),
    availableAgentIds: ["chief", "setup"],
  };
  try {
    const setup = (await store.channelStore().list("workspace-a")).find(
      (channel) => channel.slug === "dm-setup",
    );
    assert.ok(setup);
    const body = {
      content: "Google Analytics is waiting for you to sign in.",
      idempotencyKey: "setup-google-waiting",
    };
    const posted = await handleChannelLocalTool(
      new Request(
        `http://127.0.0.1:4318/local-tools/channels/${setup.id}/messages`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
      ),
      "workspace-a",
      body,
      context,
    );

    assert.equal(posted.status, undefined);
    assert.equal(
      (posted.value as { event: { content: string } }).event.content,
      body.content,
    );
  } finally {
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
