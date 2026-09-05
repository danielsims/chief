import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  GitCredentialHelperBroker,
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

void test("Git credential helper receives the HTTPS host and port, not the protocol name", async () => {
  const directory = await mkdtemp(join(tmpdir(), "chief-credential-"));
  const helper = join(directory, "helper.sh");
  const previous = { ...process.env };
  try {
    await writeFile(
      helper,
      '#!/bin/sh\nbody=$(cat)\ncase "$body" in *"host=github.example:8443"*) printf "username=git\\npassword=fixture-secret\\n";; *) exit 1;; esac\n',
      { mode: 0o700 },
    );
    process.env.GIT_CONFIG_COUNT = "2";
    process.env.GIT_CONFIG_KEY_0 = "credential.helper";
    process.env.GIT_CONFIG_VALUE_0 = "";
    process.env.GIT_CONFIG_KEY_1 = "credential.helper";
    process.env.GIT_CONFIG_VALUE_1 = helper;
    const credential = await new GitCredentialHelperBroker().request({
      organizationId: "workspace-a",
      projectId: "project-a",
      remoteUrl: "https://github.example:8443/private/repo.git",
      operation: "push",
    });
    assert.deepEqual(credential, {
      username: "git",
      password: "fixture-secret",
    });
  } finally {
    for (const key of [
      "GIT_CONFIG_COUNT",
      "GIT_CONFIG_KEY_0",
      "GIT_CONFIG_VALUE_0",
      "GIT_CONFIG_KEY_1",
      "GIT_CONFIG_VALUE_1",
    ]) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
    await rm(directory, { recursive: true, force: true });
  }
});
