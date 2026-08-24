import { isJsonObject } from "@chief/relay-contracts";

import { env } from "../env";
import { readStoredRelayConnection } from "./relay-connection";

declare global {
  var __AUTH_BASE_URL__: string | undefined;
}

function readOptionalValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === "" ? undefined : trimmed;
}

function developmentMode(meta: { readonly env?: unknown }): boolean {
  return isJsonObject(meta.env) && meta.env.DEV === true;
}

const injectedAuthBaseUrl = readOptionalValue(globalThis.__AUTH_BASE_URL__);

const storedConnection = readStoredRelayConnection();
const isDevelopment = developmentMode(import.meta);

export const CHIEF_CLOUD_RELAY_URL =
  env.VITE_CHIEF_RELAY_URL ??
  "https://chief-relay.danielsims-browser-ui.workers.dev";

export const CHIEF_CLOUD_AUTH_BASE_URL =
  env.VITE_AUTH_BASE_URL ??
  injectedAuthBaseUrl ??
  "https://chief-relay.danielsims-browser-ui.workers.dev";

export const CHIEF_CLOUD_AUTH_UI_URL =
  env.VITE_AUTH_UI_URL ??
  env.VITE_AUTH_BASE_URL ??
  injectedAuthBaseUrl ??
  (isDevelopment ? "http://localhost:3000" : "https://heychief.sh");

export const AUTH_UI_BASE_URL =
  storedConnection?.authUiUrl ?? CHIEF_CLOUD_AUTH_UI_URL;

export const RELAY_URL = storedConnection?.relayUrl ?? CHIEF_CLOUD_RELAY_URL;

export const AUTH_BASE_URL =
  storedConnection?.authBaseUrl ?? CHIEF_CLOUD_AUTH_BASE_URL;

export const USING_CUSTOM_RELAY = storedConnection !== null;

export const missingDesktopConfiguration = [
  !AUTH_UI_BASE_URL ? "VITE_AUTH_UI_URL" : null,
].filter((value): value is string => value !== null);
