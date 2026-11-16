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
    chief.subagents?.some((agent) => agent.id === "engineer"),
    true,
  );
  assert.equal(
    defaultAgents.filter((agent) => agent.id === "engineer").length,
    1,
  );
});

void test("every agent receives the shared operating model", () => {
  for (const agent of defaultAgents) {
    const instructions = composeWorkspaceInstructions(agent.instructions);
    assert.match(instructions, /Begin on the request immediately/u);
    assert.match(instructions, /#channel-slug/u);
    assert.match(instructions, /plugins_recommend/u);
    assert.match(
      instructions,
      /Chief adds 👀 to the message you're working on/u,
    );
    assert.match(
      instructions,
      /say in one specific line what you're about to do/u,
    );
  }
});
