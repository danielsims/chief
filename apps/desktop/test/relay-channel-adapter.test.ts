import assert from "node:assert/strict";
import test from "node:test";

import {
  channelMemberSchema,
  channelMembershipSchema,
  channelRecordSchema,
} from "@chief/relay-contracts";

import {
  relayConversationId,
  workspaceChannelFromRelay,
} from "../src/lib/relay-channel-adapter";

void test("resolves scoped desktop chat keys to strict relay conversation ids", () => {
  assert.equal(
    relayConversationId("channel:workspace-1:mission-control"),
    "mission-control",
  );
  assert.equal(
    relayConversationId("channel:workspace-1:mission-control", "general"),
    "general",
  );
  assert.equal(relayConversationId("direct-1"), "direct-1");
});

void test("preserves relay membership when adapting a channel for desktop", () => {
  const record = channelRecordSchema.parse({
    id: "engineering",
    workspaceId: "workspace-a",
    name: "Engineering",
    isPrivate: false,
    archived: false,
    createdAt: "2026-08-21T00:00:00.000Z",
  });
  const current = channelMembershipSchema.parse({
    conversationId: "engineering",
    kind: "user",
    principalId: "user-a",
    role: "member",
    joinedAt: "2026-08-21T00:00:00.000Z",
  });
  const channel = workspaceChannelFromRelay(
    record,
    [
      { ...current, name: "Workspace" },
      channelMemberSchema.parse({
        kind: "agent",
        principalId: "engineer",
        role: "owner",
        joinedAt: "2026-08-21T00:00:00.000Z",
        name: "Engineer",
      }),
    ],
    current,
  );

  assert.deepEqual(channel.userIds, ["workspace-owner"]);
  assert.deepEqual(channel.agentIds, ["engineer"]);
  assert.deepEqual(channel.createdBy, {
    type: "agent",
    id: "engineer",
    name: "Engineer",
  });
});

void test("does not make a visible public channel look joined", () => {
  const record = channelRecordSchema.parse({
    id: "announcements",
    workspaceId: "workspace-a",
    name: "Announcements",
    isPrivate: false,
    archived: false,
    createdAt: "2026-08-21T00:00:00.000Z",
  });
  const channel = workspaceChannelFromRelay(record, [], undefined);

  assert.deepEqual(channel.userIds, []);
});
