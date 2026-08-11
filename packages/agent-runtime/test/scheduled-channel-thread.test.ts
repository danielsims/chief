import assert from "node:assert/strict";
import test from "node:test";

import type { ChannelEvent, WorkspaceChannel } from "../src/channel-types.js";
import type { SessionManager } from "../src/manager.js";
import type { AgentSession } from "../src/session.js";
import type { AgentEvent, RecurringWorkRecord } from "../src/types.js";
import {
  channelChatId,
  MISSION_CONTROL_CHANNEL_ID,
} from "../src/channels/nip29.js";
import {
  beginScheduledChannelThread,
  runScheduledChannelThread,
} from "../src/scheduled-channel-thread.js";

const workspaceId = `manual-heartbeat-test-${process.pid}`;
const channel: WorkspaceChannel = {
  protocol: "nip29",
  id: MISSION_CONTROL_CHANNEL_ID,
  slug: "mission-control",
  name: "mission-control",
  topic: "",
  description: "",
  agentIds: ["chief"],
  userIds: ["workspace-owner"],
  kind: "standard",
  lifecycle: "active",
  createdBy: { type: "user", id: "owner", name: "Owner" },
  agentPermissions: [],
  version: 1,
  createdAt: 1,
  updatedAt: 1,
};
const work: RecurringWorkRecord = {
  id: "heartbeat",
  conversationId: channelChatId(workspaceId, channel.id),
  agentId: "chief",
  title: "Chief heartbeat",
  instructions: "Check the workspace and move useful work forward.",
  cron: "0 9 * * *",
  timezone: "Australia/Brisbane",
  operationKey: "chief-mission-control-heartbeat",
  status: "active",
  placement: "local",
  approvalSummary: "Check the workspace.",
  proposedToolPatterns: [],
  grant: { version: 1, approvedAt: 1, toolPatterns: [] },
  createdAt: 1,
  updatedAt: 1,
};

void test("scheduled work creates a durable channel thread before provider work", async () => {
  const stored: ChannelEvent[] = [];
  const broadcast: ChannelEvent[] = [];
  const manager = {
    store: {
      channelStore: () => ({
        get: () => Promise.resolve(channel),
        appendEvent: (_workspaceId: string, event: ChannelEvent) => {
          stored.push(event);
          return Promise.resolve(event);
        },
      }),
    },
  } as unknown as SessionManager;

  const heartbeat = await beginScheduledChannelThread(
    manager,
    workspaceId,
    work,
    (_workspaceId, event) => broadcast.push(event),
  );

  assert.equal(heartbeat.channelId, channel.id);
  assert.equal(stored.length, 1);
  assert.equal(broadcast.length, 1);
  const opening = stored[0];
  assert.ok(opening);
  assert.deepEqual(opening.actor, {
    type: "agent",
    id: "chief",
    name: "Chief",
  });
  assert.match(opening.content, /checking the workspace now/u);
  assert.equal(heartbeat.threadRootId, opening.id);
  assert.match(heartbeat.instructions, /localTools\.channelsMessagesPost/u);
  assert.match(heartbeat.instructions, new RegExp(channel.id, "u"));
  assert.match(heartbeat.instructions, new RegExp(opening.id, "u"));
  assert.equal(
    opening.tags.some(
      (tag) => tag[0] === "client" && tag[1] === heartbeat.messageId,
    ),
    true,
  );
});

void test("ordinary scheduled work wakes its assigned agent in the owning channel", async () => {
  let opening: ChannelEvent | undefined;
  const manager = {
    store: {
      channelStore: () => ({
        get: () => Promise.resolve(channel),
        appendEvent: (_workspaceId: string, event: ChannelEvent) => {
          opening = event;
          return Promise.resolve(event);
        },
      }),
    },
  } as unknown as SessionManager;

  const thread = await beginScheduledChannelThread(
    manager,
    workspaceId,
    {
      ...work,
      id: "weekly-report",
      agentId: "analyst",
      title: "Weekly product report",
      operationKey: "weekly-product-report",
    },
    () => undefined,
  );

  assert.equal(thread.agentId, "analyst");
  assert.ok(opening);
  assert.match(opening.content, /Weekly product report/u);
  assert.equal(
    opening.tags.some((tag) => tag[0] === "p"),
    true,
  );
});

void test("scheduled work keeps provider work and its closing update in the thread", async () => {
  const listeners = new Set<(event: AgentEvent) => void>();
  let released = false;
  let bound = false;
  let ready = false;
  let prompt:
    | {
        text: string;
        record: boolean;
        context: {
          threadRootId: string;
          mentions: string[];
          privateInstructions: string;
        };
      }
    | undefined;
  const session = {
    config: {
      driver: "codex",
      access: "full",
      workspaceId,
      executionOwner: "interactive",
    },
    on: (_event: "event", listener: (event: AgentEvent) => void) => {
      listeners.add(listener);
    },
    off: (_event: "event", listener: (event: AgentEvent) => void) => {
      listeners.delete(listener);
    },
    sendPrompt: (
      text: string,
      _messageId: string | undefined,
      record: boolean,
      context: {
        threadRootId: string;
        mentions: string[];
        privateInstructions: string;
      },
    ) => {
      prompt = { text, record, context };
      for (const listener of listeners) listener({ type: "result", ok: true });
      return Promise.resolve();
    },
  } as unknown as AgentSession;
  const manager = {
    store: {
      channelStore: () => ({
        get: () => Promise.resolve(channel),
        appendEvent: (_workspaceId: string, event: ChannelEvent) =>
          Promise.resolve(event),
      }),
    },
    acquireExecutionWhenAvailable: (
      _workspaceId: string,
      _chatId: string,
      owner: string,
    ) => {
      assert.equal(owner, "schedule");
      return Promise.resolve(() => {
        released = true;
      });
    },
  } as unknown as SessionManager;

  await runScheduledChannelThread({
    bindSession: () => {
      bound = true;
    },
    broadcast: () => undefined,
    ensureSession: () => Promise.resolve(session),
    thread: {
      agentId: "chief",
      channelId: channel.id,
      chatId: `channel:${workspaceId}:${channel.id}`,
      instructions: "Always leave a concise closing reply.",
      messageId: "heartbeat-client-root",
      threadRootId: "heartbeat-root",
    },
    manager,
    onSessionReady: () => {
      assert.equal(bound, true);
      assert.equal(prompt, undefined);
      ready = true;
    },
    workspaceId,
  });

  assert.equal(bound, true);
  assert.equal(ready, true);
  assert.equal(released, true);
  assert.ok(prompt);
  assert.equal(prompt.text, "");
  assert.equal(prompt.record, false);
  assert.equal(prompt.context.threadRootId, "heartbeat-root");
  assert.deepEqual(prompt.context.mentions, ["chief"]);
  assert.match(prompt.context.privateInstructions, /closing reply/u);
});
