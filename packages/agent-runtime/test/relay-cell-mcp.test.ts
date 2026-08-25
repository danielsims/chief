import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import { startRelayCellMcpHttpServer } from "../src/relay-cell-tools.js";

void test("a cell exposes only its permission-filtered tools over loopback MCP", async () => {
  const previous = process.env.CHIEF_AGENT_CONFIG;
  process.env.CHIEF_AGENT_CONFIG = JSON.stringify({
    enabled: true,
    driver: "codex",
    model: "gpt-5.6-luna",
    approvals: "auto",
    capabilities: [],
    integrations: [],
    toolPermissions: ["channels.read"],
  });
  const endpoint = await startRelayCellMcpHttpServer();
  const client = new Client({ name: "chief-test", version: "0.1.0" });
  const transport = new StreamableHTTPClientTransport(
    new URL(endpoint.spec.url ?? ""),
    { requestInit: { headers: endpoint.spec.headers } },
  );
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    assert.deepEqual(
      tools.tools.map((tool) => tool.name),
      ["channels_list"],
    );
    const unauthorized = await fetch(endpoint.spec.url ?? "", {
      method: "POST",
      body: "{}",
    });
    assert.equal(unauthorized.status, 404);
  } finally {
    await client.close();
    await endpoint.close();
    if (previous === undefined) delete process.env.CHIEF_AGENT_CONFIG;
    else process.env.CHIEF_AGENT_CONFIG = previous;
  }
});

void test("plugin recommendations do not grant plugin management", async () => {
  const previous = process.env.CHIEF_AGENT_CONFIG;
  process.env.CHIEF_AGENT_CONFIG = JSON.stringify({
    enabled: true,
    driver: "codex",
    model: "gpt-5.6-luna",
    approvals: "auto",
    capabilities: [],
    integrations: [],
    toolPermissions: ["messages.send", "workspace.read"],
  });
  const endpoint = await startRelayCellMcpHttpServer();
  const client = new Client({ name: "chief-test", version: "0.1.0" });
  const transport = new StreamableHTTPClientTransport(
    new URL(endpoint.spec.url ?? ""),
    { requestInit: { headers: endpoint.spec.headers } },
  );
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    const names = tools.tools.map((tool) => tool.name);
    assert.equal(names.includes("plugins_list"), true);
    assert.equal(names.includes("plugins_recommend"), true);
    assert.equal(names.includes("plugins_install"), false);
    assert.equal(names.includes("plugins_authorize"), false);
  } finally {
    await client.close();
    await endpoint.close();
    if (previous === undefined) delete process.env.CHIEF_AGENT_CONFIG;
    else process.env.CHIEF_AGENT_CONFIG = previous;
  }
});
