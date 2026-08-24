/* eslint-disable turbo/no-undeclared-env-vars -- tests exercise the git credential helper through env-provided config */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
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

void test("the credential helper broker returns a scoped credential without persisting it", async () => {
  const directory = mkdtempSync(join(tmpdir(), "chief-broker-"));
  const repository = join(directory, "source");
  execFileSync("git", ["init", "--initial-branch=main", repository]);
  try {
    const previousCount = process.env.GIT_CONFIG_COUNT;
    const previousKey = process.env.GIT_CONFIG_KEY_0;
    const previousValue = process.env.GIT_CONFIG_VALUE_0;
    process.env.GIT_CONFIG_COUNT = "1";
    process.env.GIT_CONFIG_KEY_0 = "credential.helper";
    process.env.GIT_CONFIG_VALUE_0 =
      "!f() { echo username=chief-test; echo password=ghp_TOP_SECRET_VALUE; echo; }; f";
    try {
      const broker = new GitCredentialHelperBroker();
      const credential = await broker.request({
        organizationId: "workspace-a",
        projectId: "project-1",
        remoteUrl: "https://github.com/openai/codex.git",
        operation: "push",
      });
      assert.equal(credential.username, "chief-test");
      assert.equal(credential.password, "ghp_TOP_SECRET_VALUE");
    } finally {
      if (previousCount === undefined) delete process.env.GIT_CONFIG_COUNT;
      else process.env.GIT_CONFIG_COUNT = previousCount;
      if (previousKey === undefined) delete process.env.GIT_CONFIG_KEY_0;
      else process.env.GIT_CONFIG_KEY_0 = previousKey;
      if (previousValue === undefined) delete process.env.GIT_CONFIG_VALUE_0;
      else process.env.GIT_CONFIG_VALUE_0 = previousValue;
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

void test("the broker fails closed when the credential flow yields no password", async () => {
  const directory = mkdtempSync(join(tmpdir(), "chief-broker-"));
  try {
    const previousCount = process.env.GIT_CONFIG_COUNT;
    const previousKey = process.env.GIT_CONFIG_KEY_0;
    const previousValue = process.env.GIT_CONFIG_VALUE_0;
    process.env.GIT_CONFIG_COUNT = "1";
    process.env.GIT_CONFIG_KEY_0 = "credential.helper";
    process.env.GIT_CONFIG_VALUE_0 = "true";
    try {
      const broker = new GitCredentialHelperBroker();
      await assert.rejects(
        broker.request({
          organizationId: "workspace-a",
          projectId: "project-1",
          remoteUrl: "https://github.com/openai/codex.git",
          operation: "push",
        }),
        /not a git command|could not read Username|did not provide credentials/i,
      );
    } finally {
      if (previousCount === undefined) delete process.env.GIT_CONFIG_COUNT;
      else process.env.GIT_CONFIG_COUNT = previousCount;
      if (previousKey === undefined) delete process.env.GIT_CONFIG_KEY_0;
      else process.env.GIT_CONFIG_KEY_0 = previousKey;
      if (previousValue === undefined) delete process.env.GIT_CONFIG_VALUE_0;
      else process.env.GIT_CONFIG_VALUE_0 = previousValue;
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
