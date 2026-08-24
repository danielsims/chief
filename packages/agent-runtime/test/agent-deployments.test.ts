import assert from "node:assert/strict";
import test from "node:test";

import {
  deploymentModel,
  hostedExecutorEnvironment,
} from "../src/agent-deployments.js";
import {
  agentEnvironmentKey,
  scopeRemoteAgentEnvironment,
} from "../src/remote-agent-environment.js";

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

void test("remote credentials are isolated to the selected agent pack", () => {
  const environment = {
    CHIEF_REMOTE_AGENT_URL: "https://chief.example.com",
    CHIEF_REMOTE_AGENT_TARGET: "vercel",
    CHIEF_EVE_ROUTE_PASSWORD: "chief-password",
    [agentEnvironmentKey("CHIEF_REMOTE_AGENT_URL", "analyst")]:
      "https://analyst.example.com",
    [agentEnvironmentKey("CHIEF_REMOTE_AGENT_TARGET", "analyst")]: "vercel",
    [agentEnvironmentKey("CHIEF_EVE_ROUTE_PASSWORD", "analyst")]:
      "analyst-password",
  };

  assert.deepEqual(
    {
      url: scopeRemoteAgentEnvironment(environment, "analyst")
        .CHIEF_REMOTE_AGENT_URL,
      target: scopeRemoteAgentEnvironment(environment, "analyst")
        .CHIEF_REMOTE_AGENT_TARGET,
      password: scopeRemoteAgentEnvironment(environment, "analyst")
        .CHIEF_EVE_ROUTE_PASSWORD,
    },
    {
      url: "https://analyst.example.com",
      target: "vercel",
      password: "analyst-password",
    },
  );
  assert.equal(
    scopeRemoteAgentEnvironment(environment, "prospector")
      .CHIEF_REMOTE_AGENT_URL,
    undefined,
  );
});
