import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { IncomingMessage } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import {
  parseJsonNumber,
  parseJsonObject,
  parseJsonValue,
} from "@chief/relay-contracts";

import type { McpServerSpec } from "./types.js";

function authorized(header: string | undefined, token: string) {
  const presented = Buffer.from(header ?? "");
  const expected = Buffer.from(`Bearer ${token}`);
  return (
    presented.length === expected.length && timingSafeEqual(presented, expected)
  );
}

function requestBody(request: IncomingMessage) {
  return new Promise<ReturnType<typeof parseJsonValue>>((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    let size = 0;
    request.on("data", (chunk: string | Uint8Array) => {
      const buffer =
        chunk instanceof Uint8Array ? chunk : Buffer.from(chunk, "utf8");
      size += buffer.length;
      if (size > 1_000_000) {
        reject(new Error("MCP request is too large."));
        return;
      }
      chunks.push(buffer);
    });
    request.on("end", () => {
      try {
        const value = parseJsonValue(
          JSON.parse(Buffer.concat(chunks).toString("utf8")),
        );
        if (value === undefined) throw new Error("Invalid MCP JSON body.");
        resolve(value);
      } catch (error) {
        reject(
          error instanceof Error ? error : new Error("Invalid MCP JSON body."),
        );
      }
    });
    request.on("error", reject);
  });
}

export async function startRelayCellMcpHttpTransport(
  buildServer: () => Server,
): Promise<{
  spec: McpServerSpec;
  close: () => Promise<void>;
}> {
  const token = randomBytes(32).toString("base64url");
  const httpServer = createServer((request, response) => {
    void (async () => {
      if (
        request.method !== "POST" ||
        request.url !== "/mcp" ||
        !authorized(request.headers.authorization, token)
      ) {
        response.writeHead(404).end();
        return;
      }
      const body = await requestBody(request);
      const server = buildServer();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });
      response.on("close", () => {
        void transport.close();
        void server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(request, response, body);
    })().catch(() => {
      if (!response.headersSent) {
        response
          .writeHead(400, { "content-type": "application/json" })
          .end('{"error":"Invalid MCP request."}');
      } else {
        response.end();
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(0, "127.0.0.1", () => {
      httpServer.off("error", reject);
      resolve();
    });
  });
  const port = parseJsonNumber(parseJsonObject(httpServer.address())?.port);
  if (port === undefined) {
    httpServer.close();
    throw new Error("Could not bind the cell tool endpoint.");
  }
  return {
    spec: {
      name: "chief_relay",
      command: "",
      args: [],
      url: `http://127.0.0.1:${port}/mcp`,
      headers: { Authorization: `Bearer ${token}` },
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        httpServer.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
