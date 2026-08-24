import { invoke, isTauri } from "@tauri-apps/api/core";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";

const PLUGIN_HOST_URL = "http://127.0.0.1:4318";

let tokenPromise: Promise<string> | null = null;

function delay(milliseconds: number) {
  return new Promise<void>((resolve) =>
    window.setTimeout(resolve, milliseconds),
  );
}

async function hostToken() {
  if (!isTauri()) {
    throw new Error("Plugin installation requires the Chief desktop app.");
  }
  tokenPromise ??= invoke<string>("start_plugin_host");
  try {
    return await tokenPromise;
  } catch (error) {
    tokenPromise = null;
    throw error;
  }
}

async function waitUntilReady(token: string) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      const response = await tauriFetch(`${PLUGIN_HOST_URL}/healthz`, {
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

export async function requestDesktopPluginHost<T>(
  path:
    | "/plugins/list"
    | "/plugins/install"
    | "/plugins/authorize"
    | "/plugins/uninstall",
  body: Record<string, unknown>,
) {
  const token = await hostToken();
  await waitUntilReady(token);
  const response = await tauriFetch(`${PLUGIN_HOST_URL}${path}`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const result = (await response.json()) as T & { error?: unknown };
  if (!response.ok) {
    throw new Error(
      typeof result.error === "string"
        ? result.error
        : `Plugin host returned HTTP ${response.status}.`,
    );
  }
  return result;
}
