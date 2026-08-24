import assert from "node:assert/strict";
import test from "node:test";

import { createChannelLocalToolContext } from "../src/channels/local-tool-context.js";
import { ChannelStore } from "../src/channels/store.js";

function channelStore() {
  return new ChannelStore(() => {
    throw new Error("database should not be read by this test");
  }, Promise.resolve());
}

function manager(store = channelStore()) {
  return {
    store: { channelStore: () => store },
    raiseActionItem: () => Promise.resolve(),
  };
}

void test("channel commands retain the authenticated execution identity", async () => {
  const store = channelStore();
  const context = await createChannelLocalToolContext({
    manager: manager(store),
    workspaceId: "workspace-a",
    caller: { chatId: "live-session", agentId: "engineer" },
    broadcastChannels: () => undefined,
    broadcastEvent: () => undefined,
    broadcastWorkspaceData: () => undefined,
    notifyDeletionRequest: () => undefined,
  });

  assert.ok(context);
  assert.deepEqual(context.actor, {
    type: "agent",
    id: "engineer",
    name: "Engineer",
  });
  assert.equal(context.channelStore, store);
});

void test("concurrent specialists cannot replace the capability-bound caller", async () => {
  const context = await createChannelLocalToolContext({
    manager: manager(),
    workspaceId: "workspace-a",
    caller: { chatId: "mission-session", agentId: "chief" },
    broadcastChannels: () => undefined,
    broadcastEvent: () => undefined,
    broadcastWorkspaceData: () => undefined,
    notifyDeletionRequest: () => undefined,
  });

  assert.deepEqual(context.actor, {
    type: "agent",
    id: "chief",
    name: "Chief",
  });
});
