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
  assert.match(prompt.text, /Don't use em dashes/u);
  assert.match(prompt.text, /Channels are where work lives/u);
});

void test("browser and projects rules are trimmed when unlicensed", () => {
  const engineer = getAgent("engineer");
  assert.ok(engineer);
  const prompt = assembleAgentPrompt({
    identity: engineer.instructions,
    permissions: ["channels.read", "messages.send"],
    deployment: "cloud",
  });
  assert.doesNotMatch(prompt.text, /Use the browser for live web pages/u);
  assert.doesNotMatch(prompt.text, /## Repository work/u);
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
  // A cloud agent works in the workspace Git host, not local checkouts.
  assert.match(prompt.text, /projects_create/u);
  assert.doesNotMatch(prompt.text, /projects_create_checkout/u);
  assert.match(prompt.text, /Use the browser for live web pages/u);
});

void test("the router reports the included parts for diagnostics", () => {
  const prompt = assembleAgentPrompt({
    identity: "You are a test agent.",
    permissions: ["channels.read", "messages.send"],
    deployment: "cloud",
  });
  assert.ok(prompt.parts.length > 0);
  const ids = prompt.parts.map((part) => part.id);
  assert.ok(ids.includes("voice"));
  assert.ok(ids.includes("channels-and-files"));
});
