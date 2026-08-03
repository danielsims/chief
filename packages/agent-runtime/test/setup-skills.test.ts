import assert from "node:assert/strict";
import test from "node:test";

import { setupSkillById, setupSkillFromPrompt } from "../src/setup-skills.js";

void test("provider setup skills load from concise prompt markers", () => {
  const skill = setupSkillFromPrompt(
    "[chief-skill:setup-github]\n\n@Setup, connect GitHub.",
  );

  assert.ok(skill);
  assert.equal(skill.id, "setup-github");
  assert.equal(skill.domain, "github.com");
  assert.match(skill.instructions, /fine-grained 90-day token/u);
  assert.match(skill.instructions, /captureGeneratedCredential/u);
});

void test("unknown setup skill markers are ignored", () => {
  assert.equal(setupSkillById("setup-not-real"), undefined);
  assert.equal(setupSkillFromPrompt("@Setup, connect GitHub."), undefined);
});
