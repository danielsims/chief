import assert from "node:assert/strict";
import test from "node:test";

import { createChannelLocalToolContext } from "../src/channels/local-tool-context.js";

void test("channel commands use the live agent execution identity", async () => {
  const channelStore = {};
  const manager = {
    activeAgentSession: (workspaceId: string, requestedSession?: string) => {
      assert.equal(workspaceId, "workspace-a");
      assert.equal(requestedSession, "claimed-session");
      return { chatId: "live-session", agentId: "engineer" };
    },
    store: { channelStore: () => channelStore },
  };
  const context = await createChannelLocalToolContext({
    manager: manager as never,
    workspaceId: "workspace-a",
    requestedSession: "claimed-session",
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

void test("channel commands refuse ambiguous caller attribution", async () => {
  const context = await createChannelLocalToolContext({
    manager: {
      activeAgentSession: () => undefined,
      store: { channelStore: () => ({}) },
    } as never,
    workspaceId: "workspace-a",
    broadcastChannels: () => undefined,
    broadcastEvent: () => undefined,
    broadcastWorkspaceData: () => undefined,
    notifyDeletionRequest: () => undefined,
  });

  assert.equal(context, undefined);
});
