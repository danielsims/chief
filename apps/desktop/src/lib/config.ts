import { env } from "../env";
import {
  CHIEF_CLOUD_RELAY_URL,
  desktopRelayConfiguration,
} from "./relay-config";
import { readStoredRelayConnection } from "./relay-connection";

export {
  CHIEF_CLOUD_RELAY_URL,
  CHIEF_CLOUD_AUTH_BASE_URL,
  CHIEF_CLOUD_AUTH_UI_URL,
} from "./relay-config";

declare global {
  var __AUTH_BASE_URL__: string | undefined;
}

function readOptionalValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === "" ? undefined : trimmed;
}

const injectedAuthBaseUrl = readOptionalValue(globalThis.__AUTH_BASE_URL__);

const connection = desktopRelayConfiguration(
  env,
  readStoredRelayConnection(),
  injectedAuthBaseUrl,
);

export const AUTH_UI_BASE_URL = connection.authUiUrl;
export const RELAY_URL = connection.relayUrl;
export const AUTH_BASE_URL = connection.authBaseUrl;

export const USING_CUSTOM_RELAY =
  new URL(RELAY_URL).origin !== new URL(CHIEF_CLOUD_RELAY_URL).origin;

export const missingDesktopConfiguration = [
  !AUTH_UI_BASE_URL ? "VITE_AUTH_UI_URL" : null,
].filter((value): value is string => value !== null);
