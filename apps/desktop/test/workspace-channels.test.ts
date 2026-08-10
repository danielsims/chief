import assert from "node:assert/strict";
import test from "node:test";

import type { ExecutorArtifactSummary } from "@chief/agent-runtime/artifact-types";

import { classifyArtifact } from "../src/lib/chief-artifacts";
import {
  actionConversation,
  channelChatId,
  channelIdFromChatId,
  directMessageChatId,
  directMessageIdsForChats,
  placePinnedChannel,
  placeSidebarPinnedItem,
  resolvedChannelChatId,
  WORKSPACE_CHANNELS,
  WORKSPACE_DIRECT_MESSAGES,
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

void test("keeps getting started as a stable multi-agent channel", () => {
  const channel = WORKSPACE_CHANNELS.find(
    (candidate) => candidate.id === "getting-started",
  );
  assert.ok(channel);
  assert.deepEqual(channel.agentIds, ["cmo", "setup"]);
  assert.equal(
    channelChatId(channel.id, "workspace-a"),
    "channel:workspace-a:04e8b4b0-3b65-4a83-a2e0-7fd5aa9f70c4",
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

void test("shows direct messages only after a real user conversation exists", () => {
  assert.deepEqual(
    directMessageIdsForChats(
      [
        { id: directMessageChatId("cmo", "workspace-a"), lastText: "" },
        {
          id: directMessageChatId("analyst", "workspace-a"),
          lastText: "Review this report",
        },
        { id: "unrelated", lastText: "Hello" },
      ],
      "workspace-a",
    ),
    ["analyst"],
  );
});

void test("gives every agent direct message a private stable destination", () => {
  const chatIds = WORKSPACE_DIRECT_MESSAGES.map((message) =>
    directMessageChatId(message.id, "workspace-a"),
  );
  assert.equal(new Set(chatIds).size, WORKSPACE_DIRECT_MESSAGES.length);
  assert.ok(chatIds.every((chatId) => chatId.startsWith("channel:")));
  assert.ok(
    WORKSPACE_DIRECT_MESSAGES.some((message) => message.id === "engineer"),
  );
});

void test("routes overview actions to the channel that owns the work", () => {
  assert.deepEqual(
    actionConversation({ title: "Connect GitHub", agentId: "setup" }),
    { kind: "channel", id: "getting-started" },
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
  const chief = { kind: "agent" as const, id: "cmo" as const };
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
