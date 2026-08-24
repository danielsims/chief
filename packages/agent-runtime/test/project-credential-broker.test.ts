import assert from "node:assert/strict";
import test from "node:test";

import {
  redactRemoteForDisplay,
  redactSecrets,
  redactUrlCredentials,
} from "../src/projects/credential-broker.js";

const secret = "ghp_TOP_SECRET_VALUE";
const remoteUrl = `https://${secret}@github.com/openai/codex.git`;

void test("URL credentials are redacted from display strings", () => {
  assert.equal(
    redactUrlCredentials(`fatal: ${remoteUrl}`),
    "fatal: https://***@github.com/openai/codex.git",
  );
  assert.equal(
    redactUrlCredentials("git clone https://user:pass@example.com/repo.git"),
    "git clone https://***@example.com/repo.git",
  );
  assert.equal(
    redactUrlCredentials("no credentials here"),
    "no credentials here",
  );
  assert.equal(
    redactRemoteForDisplay(remoteUrl),
    "https://***@github.com/openai/codex.git",
  );
});

void test("known secrets are stripped from logs and errors", () => {
  const messages = [
    `Authentication failed for ${secret}`,
    `git error referencing ${secret} in a trace`,
  ];
  for (const message of messages) {
    const redacted = redactSecrets(message, [secret]);
    assert.equal(redacted.includes(secret), false);
    assert.equal(redacted.includes("***"), true);
  }
  assert.equal(redactSecrets("nothing to hide", [secret]), "nothing to hide");
});
