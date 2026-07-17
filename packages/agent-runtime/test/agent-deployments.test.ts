import assert from "node:assert/strict";
import test from "node:test";

import { hostedExecutorEnvironment } from "../src/agent-deployments.js";

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
