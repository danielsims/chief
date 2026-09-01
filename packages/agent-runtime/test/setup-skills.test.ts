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
  assert.match(skill.instructions, /bundled `github` plugin/u);
  assert.match(skill.instructions, /Never broaden that selection/u);
  assert.doesNotMatch(skill.instructions, /personal access token named/u);
});

void test("unknown setup skill markers are ignored", () => {
  assert.equal(setupSkillById("setup-not-real"), undefined);
  assert.equal(setupSkillFromPrompt("@Setup, connect GitHub."), undefined);
});

void test("gmail setup skill loads with its read-only connect recipe", () => {
  const skill = setupSkillById("setup-gmail");

  assert.ok(skill);
  assert.equal(skill.id, "setup-gmail");
  assert.equal(skill.domain, "gmail.googleapis.com");
  assert.match(skill.instructions, /gmail\.readonly/u);
  assert.match(skill.instructions, /Chief - Gmail/u);
});
