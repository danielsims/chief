import assert from "node:assert/strict";
import test from "node:test";

import {
  composeWorkspaceInstructions,
  defaultAgents,
  getAgent,
} from "../src/agents/index.js";

void test("the default Chief team includes a delegated product engineer", () => {
  const engineer = getAgent("engineer");
  const chief = getAgent("chief");

  assert.ok(engineer);
  assert.ok(chief);
  assert.equal(engineer.name, "Engineer");
  assert.equal(engineer.role, "Product Engineering");
  assert.match(engineer.instructions, /small, durable code changes/);
  assert.ok(chief.delegates?.includes("engineer"));
  assert.equal(
    defaultAgents.filter((agent) => agent.id === "engineer").length,
    1,
  );
});

void test("every agent receives the mission-cell operating model", () => {
  for (const agent of defaultAgents) {
    const instructions = composeWorkspaceInstructions(agent.instructions);
    assert.match(instructions, /subject channel as its mission cell/u);
    assert.match(instructions, /private #setup channel/u);
    assert.match(instructions, /localTools\.pluginsList/u);
    assert.match(
      instructions,
      /MUST call\s+localTools\.channelsReactionsAdd with 👀 before the first work tool/u,
    );
    assert.match(
      instructions,
      /send the confirmation with\s+localTools\.channelsMessagesPost/u,
    );
    assert.match(instructions, /primary job is to advance the user's outcome/u);
    assert.match(instructions, /last-resort handoff/u);
    assert.match(
      instructions,
      /If nothing genuinely needs the user, raise no action/u,
    );
  }
});
