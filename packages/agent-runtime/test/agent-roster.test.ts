import assert from "node:assert/strict";
import test from "node:test";

import { defaultAgents, getAgent } from "../src/agents/index.js";

void test("the default Chief team includes a delegated product engineer", () => {
  const engineer = getAgent("engineer");
  const chief = getAgent("cmo");

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
