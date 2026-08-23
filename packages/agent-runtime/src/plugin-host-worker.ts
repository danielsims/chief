import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";

import { PluginRuntime } from "./plugins/runtime.js";

const port = Number(process.env.CHIEF_PLUGIN_HOST_PORT ?? 4318);
const token = process.env.CHIEF_PLUGIN_HOST_TOKEN?.trim();
const plugins = new PluginRuntime(() => undefined);

function requiredString(value: unknown, name: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${name} is required.`);
  }
  return value.trim();
}

async function readJson(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk as Uint8Array);
    size += buffer.length;
    if (size > 64_000) throw new Error("Plugin request is too large.");
    chunks.push(buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
}

function sendJson(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(body));
}

if (process.env.CHIEF_PLUGIN_HOST_SMOKE !== "1") {
  if (!token || token.length < 32) {
    throw new Error("CHIEF_PLUGIN_HOST_TOKEN is required.");
  }

  const handleRequest = async (
    request: IncomingMessage,
    response: ServerResponse,
  ) => {
    try {
      if (await plugins.handleCallback(request, response)) return;
      if (request.headers.authorization !== `Bearer ${token}`) {
        sendJson(response, 401, { error: "Unauthorized." });
        return;
      }
      const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
      if (request.method === "GET" && url.pathname === "/healthz") {
        sendJson(response, 200, { status: "ready" });
        return;
      }
      if (request.method !== "POST") {
        sendJson(response, 404, { error: "Not found." });
        return;
      }

      const input = await readJson(request);
      const workspaceId = requiredString(input.workspaceId, "workspaceId");
      if (url.pathname === "/plugins/list") {
        sendJson(response, 200, {
          snapshot: await plugins.snapshot(workspaceId, input.refresh === true),
        });
        return;
      }
      const pluginId = requiredString(input.pluginId, "pluginId");
      if (url.pathname === "/plugins/install") {
        await plugins.install(workspaceId, pluginId, input.trusted === true);
        sendJson(response, 200, {
          snapshot: await plugins.snapshot(workspaceId),
        });
        return;
      }
      if (url.pathname === "/plugins/authorize") {
        const action = await plugins.authorize(workspaceId, pluginId);
        sendJson(response, 200, {
          action,
          snapshot: await plugins.snapshot(workspaceId),
        });
        return;
      }
      if (url.pathname === "/plugins/uninstall") {
        await plugins.uninstall(workspaceId, pluginId);
        sendJson(response, 200, {
          snapshot: await plugins.snapshot(workspaceId),
        });
        return;
      }
      sendJson(response, 404, { error: "Not found." });
    } catch (error) {
      sendJson(response, 400, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const server = createServer((request, response) => {
    void handleRequest(request, response);
  });

  server.listen(port, "127.0.0.1");
  const close = () => server.close(() => process.exit(0));
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
}
