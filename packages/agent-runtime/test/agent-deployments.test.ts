import assert from "node:assert/strict";
import test from "node:test";

import {
  deploymentModel,
  hostedExecutorEnvironment,
} from "../src/agent-deployments.js";

void test("deployment model selection beats legacy environment and defaults", () => {
  assert.equal(
    deploymentModel(" openai/gpt-5.4 ", {
      CHIEF_DEPLOYMENT_MODEL: "anthropic/claude-opus-4.6",
    }),
    "openai/gpt-5.4",
  );
  assert.equal(
    deploymentModel(undefined, {
      CHIEF_DEPLOYMENT_MODEL: "anthropic/claude-opus-4.6",
    }),
    "anthropic/claude-opus-4.6",
  );
  assert.equal(deploymentModel(undefined, {}), "xai/grok-4.3");
  assert.throws(() => deploymentModel("x".repeat(201), {}), /too long/);
});

void test("cloud deployment requires hosted HTTPS Executor credentials", () => {
  assert.throws(() => hostedExecutorEnvironment({}), /EXECUTOR_MCP_URL/);
  assert.throws(
    () =>
      hostedExecutorEnvironment({
        EXECUTOR_MCP_URL: "http://localhost:4318/mcp",
        EXECUTOR_MCP_TOKEN: "token",
      }),
    /hosted HTTPS endpoint/,
  );
  assert.throws(
    () =>
      hostedExecutorEnvironment({
        EXECUTOR_MCP_URL: "https://executor.invalid/mcp",
        EXECUTOR_MCP_TOKEN: "token",
      }),
    /non-routable hosts/,
  );
  assert.deepEqual(
    hostedExecutorEnvironment({
      EXECUTOR_MCP_URL: "https://executor.example.com/mcp",
      EXECUTOR_MCP_TOKEN: " token ",
    }),
    {
      executorMcpToken: "token",
      executorMcpUrl: "https://executor.example.com/mcp",
    },
  );
});
