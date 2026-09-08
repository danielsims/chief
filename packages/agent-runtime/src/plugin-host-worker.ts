import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";

import type { JsonObject } from "@chief/relay-contracts";
import { isJsonString, parseJsonObject } from "@chief/relay-contracts";

import type { PluginCatalogSnapshot } from "./plugins/types.js";
import { PluginRuntime } from "./plugins/runtime.js";
import {
  parseLocalProjectQuery,
  queryLocalProject,
} from "./projects/local-project-query.js";
import {
  bindLocalProject,
  parseLocalProjectBinding,
  parseLocalProjectPreparation,
  prepareLocalProject,
} from "./projects/local-projects.js";

const port = Number(process.env.CHIEF_PLUGIN_HOST_PORT ?? 4318);
const token = process.env.CHIEF_PLUGIN_HOST_TOKEN?.trim();
const plugins = new PluginRuntime(() => undefined);

type PluginHostResponse =
  | Awaited<ReturnType<typeof queryLocalProject>>
  | Awaited<ReturnType<typeof prepareLocalProject>>
  | Awaited<ReturnType<typeof bindLocalProject>>
  | { error: string }
  | { status: "ready" }
  | { snapshot: PluginCatalogSnapshot }
  | {
      action: Awaited<ReturnType<PluginRuntime["authorize"]>>;
      snapshot: PluginCatalogSnapshot;
    };

function parseRequiredString(value: unknown, name: string) {
  if (!isJsonString(value) || !value.trim()) {
    throw new Error(`${name} is required.`);
  }
  return value.trim();
}

async function readJson(request: IncomingMessage): Promise<JsonObject> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    size += buffer.length;
    if (size > 64_000) throw new Error("Plugin request is too large.");
    chunks.push(buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  const value = parseJsonObject(JSON.parse(raw));
  if (!value) throw new Error("Plugin request body must be a JSON object.");
  return value;
}

function sendJson(
  response: ServerResponse,
  status: number,
  body: PluginHostResponse,
) {
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
      const workspaceId = parseRequiredString(input.workspaceId, "workspaceId");
      if (url.pathname === "/projects/query") {
        sendJson(
          response,
          200,
          await queryLocalProject(parseLocalProjectQuery(input)),
        );
        return;
      }
      if (url.pathname === "/projects/prepare") {
        sendJson(
          response,
          200,
          await prepareLocalProject(parseLocalProjectPreparation(input)),
        );
        return;
      }
      if (url.pathname === "/projects/bind") {
        sendJson(
          response,
          200,
          await bindLocalProject(parseLocalProjectBinding(input)),
        );
        return;
      }
      if (url.pathname === "/plugins/list") {
        sendJson(response, 200, {
          snapshot: await plugins.snapshot(workspaceId, input.refresh === true),
        });
        return;
      }
      const pluginId = parseRequiredString(input.pluginId, "pluginId");
      if (url.pathname === "/plugins/install") {
        await plugins.install(workspaceId, pluginId, input.trusted === true);
        sendJson(response, 200, {
          snapshot: await plugins.snapshot(workspaceId),
        });
        return;
      }
      if (url.pathname === "/plugins/authorize") {
        const oauthClient = parseJsonObject(input.oauthClient);
        if (input.oauthClient !== undefined && !oauthClient) {
          throw new Error("oauthClient must be an object.");
        }
        if (oauthClient) {
          await plugins.configureOAuthClient(workspaceId, pluginId, {
            serverName: parseRequiredString(
              oauthClient.serverName,
              "serverName",
            ),
            clientId: parseRequiredString(oauthClient.clientId, "clientId"),
            ...(oauthClient.clientSecret === undefined
              ? undefined
              : {
                  clientSecret: parseRequiredString(
                    oauthClient.clientSecret,
                    "clientSecret",
                  ),
                }),
          });
        }
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
