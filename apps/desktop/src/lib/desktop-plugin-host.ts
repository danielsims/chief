import { invoke, isTauri } from "@tauri-apps/api/core";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import type { JsonObject } from "@chief/relay-contracts";
import { isJsonString, parseJsonObject } from "@chief/relay-contracts";

interface PluginHostConnection {
  token: string;
  port: number;
}

let connectionPromise: Promise<PluginHostConnection> | null = null;

type PluginHostRequest =
  | { workspaceId: string; refresh: boolean }
  | { workspaceId: string; pluginId: string; trusted: boolean }
  | {
      workspaceId: string;
      pluginId: string;
      oauthClient?: {
        serverName: string;
        clientId: string;
        clientSecret?: string;
      };
    };

function delay(milliseconds: number) {
  return new Promise<void>((resolve) =>
    window.setTimeout(resolve, milliseconds),
  );
}

async function hostConnection() {
  if (!isTauri()) {
    throw new Error("Plugin installation requires the Chief desktop app.");
  }
  connectionPromise ??= invoke<PluginHostConnection>("start_plugin_host");
  try {
    return await connectionPromise;
  } catch (error) {
    connectionPromise = null;
    throw error;
  }
}

function pluginHostUrl(port: number) {
  return `http://127.0.0.1:${port}`;
}

async function waitUntilReady({ port, token }: PluginHostConnection) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      const response = await tauriFetch(`${pluginHostUrl(port)}/healthz`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.ok) return;
      lastError = new Error(`Plugin host returned HTTP ${response.status}.`);
    } catch (error) {
      lastError = error;
    }
    await delay(100);
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Chief's plugin host did not start.");
}

export async function requestDesktopPluginHost(
  path:
    | "/plugins/list"
    | "/plugins/install"
    | "/plugins/authorize"
    | "/plugins/uninstall",
  body: PluginHostRequest,
): Promise<JsonObject> {
  const connection = await hostConnection();
  await waitUntilReady(connection);
  const response = await tauriFetch(`${pluginHostUrl(connection.port)}${path}`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${connection.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const result = parseJsonObject(await response.json());
  if (!response.ok) {
    throw new Error(
      result && isJsonString(result.error)
        ? result.error
        : `Plugin host returned HTTP ${response.status}.`,
    );
  }
  if (!result) throw new Error("Plugin host returned an invalid response.");
  return result;
}
