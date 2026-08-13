import assert from "node:assert/strict";
import test from "node:test";

import { splitChannelReferences } from "../src/components/chat/channel-reference-parser";

const channels = [
  { id: "channel-marketing", name: "Marketing", slug: "marketing" },
  {
    id: "channel-mission-control",
    name: "Mission Control",
    slug: "mission-control",
  },
];

void test("resolves known channel references by slug and display name", () => {
  assert.deepEqual(
    splitChannelReferences("Started this in #marketing.", channels),
    [
      { type: "text", value: "Started this in " },
      {
        type: "channel",
        channelId: "channel-marketing",
        label: "#marketing",
      },
      { type: "text", value: "." },
    ],
  );
  assert.equal(
    splitChannelReferences("See #mission-control", channels)[1]?.type,
    "channel",
  );
});

void test("leaves unknown hashtags, embedded fragments, and partial slugs alone", () => {
  for (const text of [
    "Review #launch",
    "color#marketing",
    "See #marketing-plan",
  ]) {
    assert.deepEqual(splitChannelReferences(text, channels), [
      { type: "text", value: text },
    ]);
  }
});
