import assert from "node:assert/strict";
import test from "node:test";

import { composeWorkspaceInstructions } from "../src/agents/index.js";
import { defaultWorkspaceWaysOfWorking } from "../src/workspace-ways-of-working.js";

void test("mission control is the lightweight default", () => {
  assert.equal(defaultWorkspaceWaysOfWorking.mode, "mission-control");
  assert.equal(
    defaultWorkspaceWaysOfWorking.missionControlChannelId,
    "ce83fa02-5d8d-4fc1-9e31-f670676b0741",
  );
  assert.equal(defaultWorkspaceWaysOfWorking.updatedAt, 0);
});

void test("shared instructions treat channels as the operating primitives", () => {
  const instructions = composeWorkspaceInstructions("You are Chief.");
  assert.match(instructions, /channels, threads, messages, memberships/u);
  assert.match(instructions, /not a required destination or a rigid workflow/u);
  assert.match(instructions, /grants no additional authority/u);
  assert.doesNotMatch(instructions, /missions\.create/u);
});
