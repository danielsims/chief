import assert from "node:assert/strict";
import test from "node:test";

import type { ExecutorArtifactSummary } from "@chief/agent-runtime/artifact-types";

import { classifyArtifact } from "../src/lib/chief-artifacts";
import {
  channelChatId,
  placePinnedChannel,
  WORKSPACE_CHANNELS,
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
