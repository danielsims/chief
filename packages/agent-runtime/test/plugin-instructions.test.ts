import assert from "node:assert/strict";
import test from "node:test";

import { withPluginSkillInstructions } from "../src/plugins/instructions.js";

void test("portable skill context is replaced instead of accumulated", () => {
  const previous = [
    "Base agent instructions.",
    "",
    "<!-- chief:plugin-skills:start -->",
    "# Installed plugin skills",
    "- Old skill",
    "<!-- chief:plugin-skills:end -->",
  ].join("\n");

  assert.equal(
    withPluginSkillInstructions(previous, "missing-test-workspace"),
    "Base agent instructions.",
  );
});
