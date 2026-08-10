import assert from "node:assert/strict";
import test from "node:test";

import { getPlaybook } from "../src/lib/playbooks.js";

void test("measurement work stays with Setup and requires reviewable changes", () => {
  const playbook = getPlaybook("measurement-experiments");

  assert.ok(playbook);
  assert.equal(playbook.agentId, "setup");
  assert.deepEqual(
    playbook.integrations.map((integration) => integration.domain),
    ["github.com", "vercel.com", "analytics.googleapis.com", "posthog.com"],
  );
  assert.match(playbook.workflow.join("\n"), /draft pull request/i);
  assert.match(playbook.guardrails.join("\n"), /Never push.*default/i);
});
