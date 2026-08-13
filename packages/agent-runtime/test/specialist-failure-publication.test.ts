import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { channelChatId } from "../src/channels/nip29.js";
import { LocalStore } from "../src/local-store.js";
import { SessionManager } from "../src/manager.js";
import { publishSpecialistFailure } from "../src/specialist-failure-publication.js";

process.env.CHIEF_DATABASE_ENCRYPTION_KEY =
  "chief-specialist-failure-publication-test-key";

void test("an exhausted specialist posts one useful failure update in its thread", async () => {
  const directory = mkdtempSync(join(tmpdir(), "chief-specialist-failure-"));
  try {
    const store = new LocalStore(join(directory, "chief.sqlite"));
    const manager = new SessionManager(store);
    const channel = await store.channelStore().create("workspace", {
      name: "prospecting",
      agentIds: ["chief", "prospector"],
    });
    const input = {
      manager,
      workspaceId: "workspace",
      conversationId: channelChatId("workspace", channel.id),
      threadRootId: "prospecting-root",
      sessionId: "prospector-session",
      agentId: "prospector",
      agentName: "Prospector",
      title: "Find buying signals",
      error: "Reddit returned 403 and blocked the request",
    };

    await publishSpecialistFailure(input);
    await publishSpecialistFailure(input);

    const events = await store.channelStore().events("workspace", channel.id);
    assert.equal(events.length, 1);
    const [event] = events;
    assert.ok(event);
    assert.equal(event.actor.id, "prospector");
    assert.equal(
      event.tags.some((tag) => tag[0] === "e"),
      true,
    );
    assert.match(event.content, /source blocked access/i);
    assert.match(event.content, /ask me to try again/i);
    await store.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
