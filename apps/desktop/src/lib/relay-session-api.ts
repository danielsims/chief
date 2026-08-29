import { invoke, isTauri } from "@tauri-apps/api/core";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";

import {
  isJsonString,
  parseJsonObject,
  workspaceSnapshotSchema,
} from "@chief/relay-contracts";

import { requestAccountAssertion } from "./auth/account-assertion";
import { RELAY_URL } from "./config";
import { fetchWithTimeout } from "./fetch-with-timeout";
import { relayResponseError, RelaySessionError } from "./relay-response-error";

async function authorization(input: {
  url: string;
  method: string;
  body: string;
}) {
  if (!isTauri())
    throw new Error("Relay device signing requires the Chief desktop app.");
  return invoke<string>("relay_nip98_authorization", input);
}

const relayFetch: typeof fetch = (input, init) =>
  fetchWithTimeout(isTauri() ? tauriFetch : fetch, input, init);

let deviceAuthorization: string | undefined;

async function signedFetch(url: URL, init: RequestInit = {}) {
  const method = init.method?.toUpperCase() ?? "GET";
  const body = isJsonString(init.body) ? init.body : "";
  const headers = new Headers(init.headers);
  headers.set(
    "authorization",
    await authorization({ url: url.toString(), method, body }),
  );
  if (deviceAuthorization)
    headers.set("x-chief-device-authorization", deviceAuthorization);
  return relayFetch(url, { ...init, headers });
}

async function bindAccount(accountToken: string) {
  const response = await signedFetch(
    new URL("/v1/identity/device", RELAY_URL),
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accountToken }),
    },
  );
  if (!response.ok) throw await relayResponseError(response);
  const binding = parseJsonObject(await response.json());
  if (
    !binding ||
    !isJsonString(binding.deviceAuthorization) ||
    binding.deviceAuthorization.length < 32
  ) {
    throw new Error("The relay returned an invalid device authorization.");
  }
  deviceAuthorization = binding.deviceAuthorization;
}

export async function activeRelayWorkspace() {
  const response = await signedFetch(new URL("/v1/me/workspace", RELAY_URL));
  if (response.status === 204) return null;
  if (!response.ok) throw await relayResponseError(response);
  return workspaceSnapshotSchema.parse(await response.json());
}

export async function connectBoundRelayDevice(sessionToken: string) {
  if (!deviceAuthorization) {
    const bound = await bindSignedInAccount(sessionToken);
    if (!bound) return undefined;
  }
  try {
    return await activeRelayWorkspace();
  } catch (error) {
    if (!(error instanceof RelaySessionError) || error.status !== 401)
      throw error;
  }
  deviceAuthorization = undefined;
  const bound = await bindSignedInAccount(sessionToken);
  if (!bound) return undefined;
  return activeRelayWorkspace();
}

async function bindSignedInAccount(sessionToken: string) {
  const accountAssertion = await requestAccountAssertion(sessionToken);
  if (!accountAssertion) return false;
  await bindAccount(accountAssertion);
  return true;
}

export const relaySessionTransport = {
  authorization,
  fetch: relayFetch,
  getDeviceAuthorization: () => deviceAuthorization,
  resetDeviceAuthorization: () => {
    deviceAuthorization = undefined;
  },
};
