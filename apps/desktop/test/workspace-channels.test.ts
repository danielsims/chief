import assert from "node:assert/strict";
import test from "node:test";

import type { ExecutorArtifactSummary } from "@chief/agent-runtime/artifact-types";

import { classifyArtifact } from "../src/lib/chief-artifacts";
import {
  actionConversation,
  channelChatId,
  channelIdFromChatId,
  directMessageAgentIdFromChatId,
  directMessageChatId,
  directMessageIdsForAgents,
  directMessageIdsForChats,
  placePinnedChannel,
  placeSidebarPinnedItem,
  resolvedChannelChatId,
  WORKSPACE_CHANNELS,
  WORKSPACE_DIRECT_MESSAGES,
  workspaceChannel,
  workspaceDirectMessage,
} from "../src/lib/workspace-channels";

function artifact(title: string, description = ""): ExecutorArtifactSummary {
  return {
    id: title,
    title,
    description,
    preview: null,
    createdAt: 0,
    updatedAt: 0,
  };
}

void test("gives every product channel its own stable runtime session", () => {
  const chatIds = WORKSPACE_CHANNELS.map((channel) =>
    channelChatId(channel.id, "workspace-a"),
  );
  assert.equal(new Set(chatIds).size, WORKSPACE_CHANNELS.length);
  assert.ok(chatIds.every((chatId) => chatId.startsWith("channel:")));
});

void test("keeps mission control as the stable onboarding channel", () => {
  const channel = WORKSPACE_CHANNELS.find(
    (candidate) => candidate.id === "mission-control",
  );
  assert.ok(channel);
  assert.deepEqual(channel.agentIds, ["chief"]);
  assert.equal(
    channelChatId(channel.id, "workspace-a"),
    "channel:workspace-a:ce83fa02-5d8d-4fc1-9e31-f670676b0741",
  );
  assert.equal(
    channelIdFromChatId(channelChatId(channel.id, "workspace-a")),
    channel.relayId,
  );
  assert.notEqual(
    channelChatId(channel.id, "workspace-a"),
    channelChatId(channel.id, "workspace-b"),
  );
  assert.equal(
    resolvedChannelChatId(channel.id, "workspace-b", [
      { id: channelChatId(channel.id) },
    ]),
    channelChatId(channel.id),
  );
});

void test("resolves a built-in channel before the runtime channel list loads", () => {
  const engineering = WORKSPACE_CHANNELS.find(
    (channel) => channel.id === "engineering",
  );
  assert.ok(engineering);
  assert.equal(workspaceChannel(engineering.relayId)?.id, "engineering");
});

void test("prepopulates every agent direct message before the first turn", () => {
  assert.deepEqual(
    directMessageIdsForChats(),
    WORKSPACE_DIRECT_MESSAGES.map((message) => message.id),
  );
});

void test("uses the live roster for direct messages created through Eve", () => {
  const agents = [{ id: "chief" }, { id: "researcher-agent" }];
  assert.deepEqual(directMessageIdsForAgents(agents), [
    "chief",
    "researcher-agent",
  ]);
  assert.deepEqual(workspaceDirectMessage("researcher-agent", agents), {
    id: "researcher-agent",
  });
});

void test("gives every agent a workspace-scoped lazy direct destination", () => {
  const chatIds = WORKSPACE_DIRECT_MESSAGES.map((message) =>
    directMessageChatId(message.id, "workspace-a"),
  );
  assert.equal(new Set(chatIds).size, WORKSPACE_DIRECT_MESSAGES.length);
  assert.ok(chatIds.every((chatId) => chatId.startsWith("dm:workspace-a:")));
  assert.ok(
    WORKSPACE_DIRECT_MESSAGES.some((message) => message.id === "engineer"),
  );
  assert.equal(
    directMessageAgentIdFromChatId(directMessageChatId("chief", "workspace-a")),
    "chief",
  );
  assert.equal(
    directMessageAgentIdFromChatId(
      channelChatId("mission-control", "workspace-a"),
    ),
    null,
  );
});

void test("routes overview actions to the channel that owns the work", () => {
  assert.deepEqual(
    actionConversation({ title: "Connect GitHub", agentId: "setup" }),
    { kind: "channel", id: "mission-control" },
  );
  assert.deepEqual(
    actionConversation({
      title: "Connect GitHub",
      agentId: "setup",
      missionControlChannelId: "leadership",
    }),
    { kind: "channel", id: "leadership" },
  );
  assert.deepEqual(
    actionConversation({ title: "Review acquisition performance report" }),
    { kind: "channel", id: "analytics" },
  );
  assert.deepEqual(actionConversation({ title: "Review launch creative" }), {
    kind: "channel",
    id: "advertising",
  });
  assert.deepEqual(
    actionConversation({
      title: "Fix the onboarding crash",
      agentId: "engineer",
    }),
    { kind: "channel", id: "engineering" },
  );
});

void test("types durable artifacts with the same product vocabulary", () => {
  assert.equal(classifyArtifact(artifact("Acquisition report")), "analytics");
  assert.equal(
    classifyArtifact(artifact("Launch concepts", "Campaign creative options")),
    "advertising",
  );
  assert.equal(classifyArtifact(artifact("Buyer shortlist")), "prospecting");
  assert.equal(classifyArtifact(artifact("Company brief")), "general");
});

void test("moves channels into and within the pinned section", () => {
  assert.deepEqual(
    placePinnedChannel(["analytics"], "advertising", "analytics"),
    ["advertising", "analytics"],
  );
  assert.deepEqual(
    placePinnedChannel(
      ["analytics", "advertising", "prospecting"],
      "analytics",
      "prospecting",
    ),
    ["advertising", "prospecting", "analytics"],
  );
  assert.deepEqual(placePinnedChannel(["analytics"], "general", null), [
    "analytics",
    "general",
  ]);
});

void test("orders channels and agent conversations in one pinned section", () => {
  const analytics = { kind: "channel" as const, id: "analytics" };
  const chief = { kind: "agent" as const, id: "chief" as const };
  const advertising = { kind: "channel" as const, id: "advertising" };

  assert.deepEqual(placeSidebarPinnedItem([analytics], chief, analytics), [
    chief,
    analytics,
  ]);
  assert.deepEqual(
    placeSidebarPinnedItem([chief, analytics], advertising, null),
    [chief, analytics, advertising],
  );
  assert.deepEqual(
    placeSidebarPinnedItem([chief, analytics], chief, analytics),
    [analytics, chief],
  );
});
