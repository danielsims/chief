import assert from "node:assert/strict";
import test from "node:test";

import type { ExecutorArtifactSummary } from "@chief/agent-runtime/artifact-types";

import { classifyArtifact } from "../src/lib/chief-artifacts";
import {
  actionConversation,
  channelChatId,
  directMessageChatId,
  directMessageIdsForChats,
  placePinnedChannel,
  placeSidebarPinnedItem,
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
    channelChatId(channel.id),
  );
  assert.equal(new Set(chatIds).size, WORKSPACE_CHANNELS.length);
  assert.ok(chatIds.every((chatId) => chatId.startsWith("channel:")));
});

void test("shows direct messages only after a real user conversation exists", () => {
  assert.deepEqual(
    directMessageIdsForChats([
      { id: directMessageChatId("cmo"), lastText: "" },
      { id: directMessageChatId("analyst"), lastText: "Review this report" },
      { id: "unrelated", lastText: "Hello" },
    ]),
    ["analyst"],
  );
});

void test("gives every agent direct message a private stable destination", () => {
  const chatIds = WORKSPACE_DIRECT_MESSAGES.map((message) =>
    directMessageChatId(message.id),
  );
  assert.equal(new Set(chatIds).size, WORKSPACE_DIRECT_MESSAGES.length);
  assert.ok(chatIds.every((chatId) => chatId.startsWith("channel:")));
});

void test("routes overview actions to the channel that owns the work", () => {
  assert.deepEqual(
    actionConversation({ title: "Connect GitHub", agentId: "setup" }),
    { kind: "dm", id: "setup" },
  );
  assert.deepEqual(
    actionConversation({ title: "Review acquisition performance report" }),
    { kind: "channel", id: "analytics" },
  );
  assert.deepEqual(actionConversation({ title: "Review launch creative" }), {
    kind: "channel",
    id: "advertising",
  });
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
