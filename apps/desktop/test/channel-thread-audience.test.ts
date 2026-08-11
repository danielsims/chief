import assert from "node:assert/strict";
import test from "node:test";

import {
  channelRecipients,
  threadAgentAudience,
} from "../src/components/chat/channel-thread-audience.js";

const knownAgents = new Set(["chief", "analyst", "brand"]);

void test("ordinary channel messages remain passive", () => {
  assert.deepEqual(channelRecipients([], [], knownAgents), []);
});

void test("an untagged thread reply keeps the last addressed agent active", () => {
  const audience = threadAgentAudience(
    [
      { role: "user", metadata: { mentions: ["analyst"] } },
      { role: "assistant", metadata: { mentions: ["analyst"] } },
      { role: "user" },
    ],
    knownAgents,
  );

  assert.deepEqual(channelRecipients([], audience, knownAgents), ["analyst"]);
});

void test("a new explicit mention replaces the active thread audience", () => {
  const audience = threadAgentAudience(
    [
      { role: "user", metadata: { mentions: ["analyst"] } },
      { role: "user", metadata: { mentions: ["brand"] } },
    ],
    knownAgents,
  );

  assert.deepEqual(channelRecipients([], audience, knownAgents), ["brand"]);
  assert.deepEqual(channelRecipients(["chief"], audience, knownAgents), [
    "chief",
  ]);
});

void test("thread audiences discard unknown and duplicate agent ids", () => {
  assert.deepEqual(
    threadAgentAudience(
      [
        {
          role: "user",
          metadata: { mentions: ["analyst", "unknown", "analyst"] },
        },
      ],
      knownAgents,
    ),
    ["analyst"],
  );
});
