import assert from "node:assert/strict";
import test from "node:test";

import { createChannelLocalToolContext } from "../src/channels/local-tool-context.js";

void test("channel commands retain the authenticated execution identity", async () => {
  const channelStore = {};
  const manager = {
    activeAgentSession: () => {
      throw new Error("authenticated callers must not be re-resolved");
    },
    store: { channelStore: () => channelStore },
  };
  const context = await createChannelLocalToolContext({
    manager: manager as never,
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
  assert.equal(context.channelStore, channelStore);
});

void test("concurrent specialists cannot replace the capability-bound caller", async () => {
  const context = await createChannelLocalToolContext({
    manager: {
      activeAgentSession: () => ({
        chatId: "specialist-session",
        agentId: "brand",
      }),
      store: { channelStore: () => ({}) },
    } as never,
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
