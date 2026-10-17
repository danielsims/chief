import assert from "node:assert/strict";
import test from "node:test";

import type { JsonObject, JsonValue } from "@chief/relay-contracts";
import { parseJsonObject } from "@chief/relay-contracts";

import type { StartOptions } from "../src/types.js";
import {
  initializeOpenCodeSession,
  openCodeConfigContent,
} from "../src/drivers/opencode-support.js";

function startOptions(model?: string): StartOptions {
  return {
    cwd: "/tmp/opencode-session",
    instructions: "",
    access: "guarded",
    ...(model ? { model } : undefined),
  };
}

type Rpc = (
  method: string,
  params: JsonObject,
) => Promise<JsonValue | undefined>;

function recordingRpc(
  calls: string[],
  responses: Record<string, JsonValue>,
): Rpc {
  return (method) => {
    calls.push(method);
    return Promise.resolve(responses[method]);
  };
}

void test("OpenCode v2 selects the configured model over config options", async () => {
  const calls: string[] = [];
  const result = await initializeOpenCodeSession(
    startOptions("opencode-go/deepseek-v4-flash"),
    undefined,
    recordingRpc(calls, {
      initialize: { agentCapabilities: {} },
      "session/new": {
        sessionId: "ses-v2",
        configOptions: [
          {
            id: "model",
            category: "model",
            currentValue: "opencode-go/claude-haiku-5-5",
          },
        ],
      },
      "session/set_config_option": {
        configOptions: [
          {
            id: "model",
            category: "model",
            currentValue: "opencode-go/deepseek-v4-flash",
          },
        ],
      },
    }),
  );

  assert.deepEqual(calls, [
    "initialize",
    "session/new",
    "session/set_config_option",
  ]);
  assert.equal(result.sessionId, "ses-v2");
  assert.equal(result.model, "opencode-go/deepseek-v4-flash");
});

void test("OpenCode v2 keeps the provider default when no model is configured", async () => {
  const calls: string[] = [];
  const result = await initializeOpenCodeSession(
    startOptions(),
    undefined,
    recordingRpc(calls, {
      initialize: { agentCapabilities: {} },
      "session/new": {
        sessionId: "ses-default",
        configOptions: [
          {
            id: "model",
            category: "model",
            currentValue: "opencode-go/claude-haiku-5-5",
          },
        ],
      },
    }),
  );

  assert.deepEqual(calls, ["initialize", "session/new"]);
  assert.equal(result.model, "opencode-go/claude-haiku-5-5");
});

void test("OpenCode v2 resolves bare model ids against advertised options", async () => {
  const responses: Record<string, JsonValue> = {
    initialize: { agentCapabilities: {} },
    "session/new": {
      sessionId: "ses-bare",
      configOptions: [
        {
          id: "model",
          category: "model",
          currentValue: "opencode-go/claude-haiku-5-5",
          options: [
            { value: "opencode-go/claude-haiku-5-5" },
            { value: "opencode-go/deepseek-v4.1-flash" },
          ],
        },
      ],
    },
    "session/set_config_option": {
      configOptions: [
        {
          id: "model",
          category: "model",
          currentValue: "opencode-go/deepseek-v4.1-flash",
        },
      ],
    },
  };
  const selected: JsonValue[] = [];
  const result = await initializeOpenCodeSession(
    startOptions("deepseek-v4.1-flash"),
    undefined,
    (method, params) => {
      if (
        method === "session/set_config_option" &&
        params.value !== undefined
      ) {
        selected.push(params.value);
      }
      return Promise.resolve(responses[method]);
    },
  );

  assert.deepEqual(selected, ["opencode-go/deepseek-v4.1-flash"]);
  assert.equal(result.model, "opencode-go/deepseek-v4.1-flash");
});

void test("OpenCode v2 selects the model when resuming a session", async () => {
  const calls: string[] = [];
  const result = await initializeOpenCodeSession(
    startOptions("opencode-go/deepseek-v4-flash"),
    "ses-existing",
    recordingRpc(calls, {
      initialize: { agentCapabilities: { loadSession: true } },
      "session/load": {
        sessionId: "ses-existing",
        configOptions: [
          {
            id: "model",
            category: "model",
            currentValue: "opencode-go/claude-haiku-5-5",
          },
        ],
      },
      "session/set_config_option": {
        configOptions: [
          {
            id: "model",
            category: "model",
            currentValue: "opencode-go/deepseek-v4-flash",
          },
        ],
      },
    }),
  );

  assert.deepEqual(calls, [
    "initialize",
    "session/load",
    "session/set_config_option",
  ]);
  assert.equal(result.sessionId, "ses-existing");
  assert.equal(result.model, "opencode-go/deepseek-v4-flash");
});

void test("OpenCode v1 reads the resolved model without selecting", async () => {
  const calls: string[] = [];
  const result = await initializeOpenCodeSession(
    startOptions("opencode-go/deepseek-v4-flash"),
    undefined,
    recordingRpc(calls, {
      initialize: { agentCapabilities: {} },
      "session/new": {
        sessionId: "ses-v1",
        models: { currentModelId: "opencode-go/deepseek-v4-flash" },
      },
    }),
  );

  assert.deepEqual(calls, ["initialize", "session/new"]);
  assert.equal(result.sessionId, "ses-v1");
  assert.equal(result.model, "opencode-go/deepseek-v4-flash");
});

void test("full OpenCode sessions cannot stall on hidden external-directory approval", () => {
  const config = parseJsonObject(
    JSON.parse(
      openCodeConfigContent(
        { access: "full", model: "opencode-go/deepseek-v4-flash" },
        JSON.stringify({
          permission: { bash: { "*": "ask", "git status*": "allow" } },
        }),
      ),
    ),
  );
  assert.ok(config);

  assert.equal(config.model, "opencode-go/deepseek-v4-flash");
  assert.deepEqual(config.permission, {
    bash: { "*": "ask", "git status*": "allow" },
    external_directory: "allow",
  });
});

void test("guarded OpenCode sessions do not widen ambient permissions", () => {
  const inherited = JSON.stringify({
    permission: { external_directory: "deny", edit: "ask" },
  });
  const config = parseJsonObject(
    JSON.parse(
      openCodeConfigContent({ access: "guarded", model: "" }, inherited),
    ),
  );
  assert.ok(config);

  assert.deepEqual(config.permission, {
    external_directory: "deny",
    edit: "ask",
  });
  assert.equal("model" in config, false);
});

void test("full OpenCode sessions recover from malformed ambient config", () => {
  const config = parseJsonObject(
    JSON.parse(
      openCodeConfigContent({ access: "full", model: "model-id" }, "not-json"),
    ),
  );
  assert.ok(config);

  assert.equal(config.model, "model-id");
  assert.deepEqual(config.permission, { external_directory: "allow" });
});
