import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { codexMcpResultText } from "../src/drivers/codex.js";
import {
  executorStructuredResult,
  existingExecutorWorkspace,
  googleAnalyticsSpecOverrides,
  prepareGoogleAnalyticsSpec,
} from "../src/tools/control-plane.js";
import { redactExecutorHandoffCredentials } from "../src/tools/redaction.js";
import { executorToolServer } from "../src/tools/spec.js";

void test("Executor keychain storage is isolated per Chief workspace", () => {
  const first = existingExecutorWorkspace("workspace-a");
  const same = existingExecutorWorkspace("workspace-a");
  const second = existingExecutorWorkspace("workspace-b");

  assert.equal(first.keychainServiceName, same.keychainServiceName);
  assert.notEqual(first.keychainServiceName, second.keychainServiceName);
  assert.match(first.keychainServiceName, /^chief-executor-[a-f0-9]{24}$/);
  assert.equal(
    executorToolServer(first).env?.EXECUTOR_KEYCHAIN_SERVICE_NAME,
    first.keychainServiceName,
  );
});

void test("Executor HTTP transports preserve the requested approval mode", (context) => {
  const root = mkdtempSync(join(tmpdir(), "chief-executor-transport-"));
  context.after(() => rmSync(root, { force: true, recursive: true }));
  const workspace = {
    scopeDir: join(root, "scope"),
    dataDir: join(root, "data"),
    keychainServiceName: "chief-executor-test",
  };
  const controlDirectory = join(workspace.dataDir, "server-control");
  mkdirSync(controlDirectory, { recursive: true });
  writeFileSync(
    join(controlDirectory, "server.json"),
    JSON.stringify({
      connection: {
        origin: "http://127.0.0.1:4123",
        auth: { kind: "bearer", token: "test-token" },
      },
    }),
  );
  assert.equal(
    executorToolServer(workspace, "browser").url,
    "http://127.0.0.1:4123/mcp?elicitation_mode=browser",
  );
  assert.equal(
    executorToolServer(workspace, "model").url,
    "http://127.0.0.1:4123/mcp?elicitation_mode=model",
  );
});

void test("Executor handoff credentials are redacted from browser snapshots", () => {
  assert.equal(
    redactExecutorHandoffCredentials(
      "http://127.0.0.1:4123/resume/run?_token=secret&next=1",
    ),
    "http://127.0.0.1:4123/resume/run?_token=[redacted]&next=1",
  );
});

void test("Google Analytics adds account discovery to the broad reporting spec", () => {
  const spec = prepareGoogleAnalyticsSpec({
    openapi: "3.0.0",
    paths: {
      "/v1beta/{name}": {
        get: {
          parameters: [
            { name: "name", in: "path", schema: { type: "string" } },
          ],
        },
      },
    },
  }) as {
    paths: Record<
      string,
      { get: { parameters: { allowReserved?: boolean }[] } }
    >;
  };
  assert.equal(
    spec.paths["/v1beta/{name}"]?.get.parameters[0]?.allowReserved,
    true,
  );
  assert.ok(spec.paths["/v1beta/accountSummaries"]);

  const overrides = googleAnalyticsSpecOverrides();
  assert.deepEqual(
    overrides.map((override) => override.op),
    ["add"],
  );
  const override = overrides[0];
  assert.ok(override);
  assert.equal(override.path, "/paths/~1v1beta~1accountSummaries");
  assert.equal(
    override.value.get["x-executor-toolPath"],
    "accountSummaries.list",
  );
  assert.equal(
    override.value.get.servers[0]?.url,
    "https://analyticsadmin.googleapis.com",
  );
});

void test("Executor structured results remain complete beyond the text preview limit", () => {
  const value = { dimensions: "x".repeat(40_000) };
  assert.deepEqual(
    executorStructuredResult({
      status: "completed",
      text: JSON.stringify(value).slice(0, 30_000),
      structured: { result: value },
      isError: false,
    }),
    value,
  );
  const parsed = JSON.parse(
    codexMcpResultText({
      result: {
        content: [{ type: "text", text: "x".repeat(30_000) }],
        structuredContent: value,
      },
    }),
  ) as { dimensions: string };
  assert.equal(parsed.dimensions.length, 40_000);
});
