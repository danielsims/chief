import assert from "node:assert/strict";
import test from "node:test";

import type { ExecutorArtifactSummary } from "@chief/agent-runtime/artifact-types";

import type { LocalChatSummary } from "../src/lib/runtime";
import { classifyArtifact } from "../src/lib/chief-artifacts";
import { channelForChat } from "../src/lib/workspace-channels";

function chat(title: string, lastText = ""): LocalChatSummary {
  return {
    id: title,
    agent: "chief",
    title,
    lastText,
    lastAt: 0,
    running: false,
  };
}

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

void test("places existing conversations into canonical channels", () => {
  assert.equal(channelForChat(chat("Google Analytics setup")), "analytics");
  assert.equal(channelForChat(chat("Plan launch campaign")), "advertising");
  assert.equal(channelForChat(chat("Research new prospects")), "prospecting");
  assert.equal(channelForChat(chat("Set up a new integration")), "general");
});

void test("uses recent conversation text when assigning a channel", () => {
  assert.equal(
    channelForChat(chat("Weekly review", "Traffic performance is ready")),
    "analytics",
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
