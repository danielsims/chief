import assert from "node:assert/strict";
import test from "node:test";

import type { ChannelEvent } from "@chief/agent-runtime/types";

import {
  channelActionFromEvent,
  channelMembershipTargetNames,
  formatMembershipTargets,
} from "../src/lib/channel-actions";

const inviteEvent: ChannelEvent = {
  protocol: "nip29",
  id: "invite-event",
  channelId: "agent-cli-dogfood",
  pubkey: "engineer-pubkey",
  tags: [
    ["h", "agent-cli-dogfood"],
    ["action", "member-added"],
    ["user", "workspace-owner"],
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
    userIds: ["workspace-owner"],
  });
  assert.ok(action);
  const names = channelMembershipTargetNames(action, (agentId) =>
    agentId === "analyst" ? "Analyst" : agentId,
  );
  assert.equal(formatMembershipTargets(names), "you and Analyst");
});
