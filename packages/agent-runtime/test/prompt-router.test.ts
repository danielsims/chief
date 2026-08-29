import assert from "node:assert/strict";
import test from "node:test";

import { getAgent } from "../src/agents/index.js";
import { assembleAgentPrompt } from "../src/prompts/index.js";

void test("a hosted cloud agent gets the full persona and the em-dash ban", () => {
  const engineer = getAgent("engineer");
  assert.ok(engineer);
  const prompt = assembleAgentPrompt({
    identity: engineer.instructions,
    permissions: ["channels.read", "channels.create", "messages.send"],
    deployment: "cloud",
  });
  assert.match(prompt.text, /small, durable code changes/u);
  assert.match(prompt.text, /Never use an em dash character/u);
  assert.match(
    prompt.text,
    /Treat an agent's subject channel as its mission cell/u,
  );
});

void test("browser and projects rules are trimmed when unlicensed", () => {
  const engineer = getAgent("engineer");
  assert.ok(engineer);
  const prompt = assembleAgentPrompt({
    identity: engineer.instructions,
    permissions: ["channels.read", "messages.send"],
    deployment: "cloud",
  });
  assert.doesNotMatch(prompt.text, /localTools\.browserOpen/u);
  assert.doesNotMatch(prompt.text, /projectsCreateCheckout/u);
});

void test("browser and projects rules appear when licensed", () => {
  const prosaic = getAgent("engineer");
  assert.ok(prosaic);
  const prompt = assembleAgentPrompt({
    identity: prosaic.instructions,
    permissions: [
      "projects.read",
      "projects.write",
      "browser.use",
      "channels.read",
      "messages.send",
    ],
    deployment: "cloud",
  });
  assert.match(prompt.text, /projectsCreateCheckout/u);
  assert.match(prompt.text, /Use the visible browser only/u);
  assert.match(prompt.text, /owning conversation/u);
});

void test("the router reports the included parts for diagnostics", () => {
  const prompt = assembleAgentPrompt({
    identity: "You are a test agent.",
    permissions: ["channels.read", "messages.send"],
    deployment: "cloud",
  });
  assert.ok(prompt.parts.length > 0);
  const ids = prompt.parts.map((part) => part.id);
  assert.ok(ids.includes("tone.teammate"));
  assert.ok(ids.includes("mission.cell"));
});
