import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import test from "node:test";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import {
  agentLocalOperations,
  createAgentLocalMcpHandler,
} from "../src/agent-local-mcp.js";
import { localToolsOpenApi } from "../src/local-tools.js";

void test("agent-bound MCP exposes Chief local operations with resolved schemas", () => {
  const operations = agentLocalOperations(
    localToolsOpenApi("http://127.0.0.1:4318"),
  );

  const saveProfile = operations.get("localTools.brandProfileSave");
  assert.ok(saveProfile);
  assert.equal(saveProfile.method, "POST");
  assert.equal(saveProfile.path, "/local-tools/brand-profile");
  assert.equal(saveProfile.inputSchema.type, "object");
  assert.deepEqual(saveProfile.inputSchema.required, ["markdown"]);

  const listProspects = operations.get("localTools.prospectsList");
  assert.ok(listProspects);
  assert.equal(listProspects.method, "GET");
  assert.equal(listProspects.inputSchema.type, "object");

  const postMessage = operations.get("localTools.channelsMessagesPost");
  assert.ok(postMessage);
  assert.deepEqual(postMessage.inputSchema.required, ["content", "channelId"]);
  assert.deepEqual(
    (postMessage.inputSchema.properties as Record<string, unknown>).channelId,
    { type: "string" },
  );
  assert.equal(
    (postMessage.inputSchema.properties as Record<string, unknown>).content !==
      undefined,
    true,
  );

  const listMessages = operations.get("localTools.channelsMessagesList");
  assert.ok(listMessages);
  assert.deepEqual(listMessages.inputSchema.required, ["channelId"]);
  assert.deepEqual(
    (listMessages.inputSchema.properties as Record<string, unknown>).channelId,
    { type: "string" },
  );
  assert.equal(
    (listMessages.inputSchema.properties as Record<string, unknown>).cursor !==
      undefined,
    true,
  );
  assert.equal(operations.has("localTools.specialistsDelegate"), true);
});

void test("agent-bound MCP rejects workspace tokens and forwards the session capability", async () => {
  let observedAuthorization = "";
  let observedMessageBody = "";
  let observedMessagePath = "";
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const handleMcp = createAgentLocalMcpHandler({
    authenticate: (token) =>
      token === "live-agent-token"
        ? {
            kind: "agent-session",
            workspaceId: "workspace",
            agentId: "brand",
            sessionId: "specialist",
            expiresAt: Date.now() + 60_000,
          }
        : token === "workspace-token"
          ? { kind: "workspace-gateway", workspaceId: "workspace" }
          : undefined,
    openApi: () => localToolsOpenApi(origin),
    origin,
  });
  server.on("request", (request, response) => {
    if (request.url === "/local-tools/brand-profile") {
      observedAuthorization = request.headers.authorization ?? "";
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ saved: true }));
      return;
    }
    if (request.url === "/local-tools/channels/channel-a/messages") {
      observedMessagePath = request.url;
      request.on("data", (chunk: unknown) => {
        observedMessageBody += String(chunk);
      });
      request.on("end", () => {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ posted: true }));
      });
      return;
    }
    void handleMcp(request, response);
  });
  try {
    const unauthorized = await fetch(`${origin}/agent-local-mcp`, {
      method: "POST",
      headers: {
        authorization: "Bearer workspace-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "test", version: "0.1.0" },
        },
      }),
    });
    assert.equal(unauthorized.status, 401);

    const client = new Client({ name: "test", version: "0.1.0" });
    const transport = new StreamableHTTPClientTransport(
      new URL(`${origin}/agent-local-mcp`),
      {
        requestInit: {
          headers: { authorization: "Bearer live-agent-token" },
        },
      },
    );
    await client.connect(transport);
    const result = await client.callTool({
      name: "localTools.brandProfileSave",
      arguments: { markdown: "# Profile" },
    });
    assert.equal(result.isError, false);
    assert.equal(observedAuthorization, "Bearer live-agent-token");
    assert.match(JSON.stringify(result.content), /saved/);
    const posted = await client.callTool({
      name: "localTools.channelsMessagesPost",
      arguments: { channelId: "channel-a", content: "Thread update" },
    });
    assert.equal(posted.isError, false);
    assert.equal(
      observedMessagePath,
      "/local-tools/channels/channel-a/messages",
    );
    assert.deepEqual(JSON.parse(observedMessageBody), {
      content: "Thread update",
    });
    await client.close();
  } finally {
    server.close();
    await once(server, "close");
  }
});
