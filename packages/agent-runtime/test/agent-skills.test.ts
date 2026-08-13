import assert from "node:assert/strict";
import test from "node:test";

import {
  agentSkillById,
  agentSkillFromPrompt,
  listAgentSkills,
} from "../src/agent-skills.js";

void test("agents discover their own Markdown skills from their filesystem", () => {
  const skill = agentSkillById("brand", "build-brand-profile");

  assert.ok(skill);
  assert.equal(skill.label, "Build Brand Profile");
  assert.match(skill.sourcePath, /agents\/brand\/skills/u);
  assert.match(skill.instructions, /# Build brand profile/u);
  assert.match(skill.instructions, /localTools\.brandProfileSave/u);
  assert.match(skill.instructions, /localTools\.filesWrite/u);
  assert.match(skill.instructions, /existing files/u);
});

void test("a chat skill attachment only resolves for its owning agent", () => {
  const prompt =
    "Hey @Prospector, use [chief-skill:find-buying-signals] to find our first buying signals.";

  assert.equal(agentSkillFromPrompt("brand", prompt), undefined);
  assert.equal(
    agentSkillFromPrompt("prospector", prompt)?.id,
    "find-buying-signals",
  );
});

void test("Setup catalog metadata lives in its Markdown frontmatter", () => {
  const skills = listAgentSkills("setup");
  const analytics = skills.find(
    (skill) => skill.id === "setup-google-analytics",
  );

  assert.ok(analytics);
  assert.equal(analytics.domain, "analytics.googleapis.com");
  assert.equal(analytics.label, "Connect Google Analytics");
});
