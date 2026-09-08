import assert from "node:assert/strict";
import test from "node:test";

import type { ChannelEvent } from "@chief/agent-runtime/types";

import {
  channelActionFromEvent,
  channelMembershipTargetNames,
  formatMembershipTargets,
  isChannelMembershipMessage,
} from "../src/lib/channel-actions";

const inviteEvent: ChannelEvent = {
  protocol: "nip29",
  id: "invite-event",
  channelId: "agent-cli-dogfood",
  pubkey: "engineer-pubkey",
  tags: [
    ["h", "agent-cli-dogfood"],
    ["action", "member-added"],
    ["user", "user-123"],
    ["agent", "analyst"],
  ],
  content: "Engineer added you and Analyst to the channel.",
  actor: { type: "agent", id: "engineer", name: "Engineer" },
  kind: 9,
  createdAt: 1,
};

void test("reconstructs agent-authored membership UI from a durable event", () => {
  const action = channelActionFromEvent(inviteEvent);
  assert.deepEqual(action, {
    type: "member-added",
    actorName: "Engineer",
    actorId: "engineer",
    actorType: "agent",
    agentIds: ["analyst"],
    userIds: ["user-123"],
  });
  assert.ok(action);
  const names = channelMembershipTargetNames(
    action,
    (agentId) => (agentId === "analyst" ? "Analyst" : agentId),
    "user-123",
  );
  assert.equal(formatMembershipTargets(names), "you and Analyst");
});

void test("detects live channel membership messages from channel-action components", () => {
  assert.equal(
    isChannelMembershipMessage({
      components: [
        {
          id: "membership-1",
          kind: "channel-action",
          version: 1,
          payload: {
            type: "member-added",
            actorId: "chief",
            actorName: "Chief",
            actorType: "agent",
            targetId: "workspace-owner",
            targetKind: "user",
            targetName: "Workspace",
            targetIds: "workspace-owner",
            targetNames: "Workspace",
            agentIds: "",
            userIds: "workspace-owner",
          },
        },
      ],
    }),
    true,
  );
  assert.equal(
    isChannelMembershipMessage({
      components: [
        {
          id: "tool-1",
          kind: "tool",
          version: 1,
          payload: { name: "search" },
        },
      ],
    }),
    false,
  );
});
