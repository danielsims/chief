import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { ServerMessage } from "../src/types.js";
import { channelChatId } from "../src/channels/nip29.js";
import { mirrorEvent } from "../src/channels/server-bridge.js";
import { LocalStore } from "../src/local-store.js";
import { SessionManager } from "../src/manager.js";

process.env.CHIEF_DATABASE_ENCRYPTION_KEY =
  "chief-channel-event-mirroring-test-key";

void test("mirrored replies target the durable root event", async () => {
  const directory = mkdtempSync(join(tmpdir(), "chief-thread-mirror-"));
  const store = new LocalStore(join(directory, "chief.sqlite"));
  try {
    const manager = new SessionManager(store);
    const channel = (await store.channelStore().list("workspace")).find(
      (candidate) => candidate.slug === "general",
    );
    assert.ok(channel);
    const send = (_message: ServerMessage) => undefined;
    const chatId = channelChatId("workspace", channel.id);
    const root = await mirrorEvent(manager, send, "workspace", chatId, {
      type: "message",
      id: "client-root",
      role: "user",
      content: [{ type: "text", text: "What changed?" }],
    });
    assert.ok(root);
    const reply = await mirrorEvent(manager, send, "workspace", chatId, {
      type: "message",
      id: "client-reply",
      role: "assistant",
      content: [{ type: "text", text: "The work is complete." }],
      threadRootId: "client-root",
    });
    assert.ok(reply);
    assert.equal(
      reply.tags.some(
        (tag) => tag[0] === "e" && tag[1] === root.id && tag[3] === "root",
      ),
      true,
    );
  } finally {
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
