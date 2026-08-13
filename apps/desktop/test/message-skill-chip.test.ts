import assert from "node:assert/strict";
import test from "node:test";

import {
  messageSkill,
  splitSkillReferences,
} from "../src/components/chat/message-skill-chip.js";

void test("skill attachments render as a compact label instead of prompt text", () => {
  assert.deepEqual(
    messageSkill(
      "[chief-skill:build-brand-profile]\n\n@Marketer, build our first working brand profile.",
    ),
    {
      id: "build-brand-profile",
      inlineText:
        "[chief-skill:build-brand-profile] @Marketer, build our first working brand profile.",
      label: "Build brand profile",
      visibleText: "@Marketer, build our first working brand profile.",
    },
  );
});

void test("skills remain inline with surrounding message content", () => {
  assert.deepEqual(
    splitSkillReferences(
      "Ask @Marketer to use [chief-skill:build-brand-profile] today.",
    ),
    [
      { type: "text", value: "Ask @Marketer to use " },
      {
        type: "skill",
        id: "build-brand-profile",
        label: "Build brand profile",
      },
      { type: "text", value: " today." },
    ],
  );
});

void test("Google Analytics uses the user-facing skill label", () => {
  assert.equal(
    messageSkill("[chief-skill:setup-google-analytics]").label,
    "Connect Google Analytics",
  );
});
