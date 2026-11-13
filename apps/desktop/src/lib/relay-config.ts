import type { StoredRelayConnection } from "./relay-connection";

// Chief Cloud's identity stays fixed when development selects a local relay.
export const CHIEF_CLOUD_RELAY_URL = "https://relay.heychief.sh";
export const CHIEF_CLOUD_AUTH_BASE_URL = "https://relay.heychief.sh";
export const CHIEF_CLOUD_AUTH_UI_URL = "https://heychief.sh";

export function desktopRelayConfiguration(
  environment: {
    VITE_CHIEF_RELAY_URL?: string;
    VITE_AUTH_BASE_URL?: string;
    VITE_AUTH_UI_URL?: string;
  },
  storedConnection: StoredRelayConnection | null,
  injectedAuthBaseUrl?: string,
) {
  const relayUrl = environment.VITE_CHIEF_RELAY_URL ?? CHIEF_CLOUD_RELAY_URL;
  const authBaseUrl =
    environment.VITE_AUTH_BASE_URL ??
    injectedAuthBaseUrl ??
    CHIEF_CLOUD_AUTH_BASE_URL;
  const authUiUrl =
    environment.VITE_AUTH_UI_URL ??
    environment.VITE_AUTH_BASE_URL ??
    injectedAuthBaseUrl ??
    CHIEF_CLOUD_AUTH_UI_URL;
  return {
    relayUrl: storedConnection?.relayUrl ?? relayUrl,
    authBaseUrl: storedConnection?.authBaseUrl ?? authBaseUrl,
    authUiUrl: storedConnection?.authUiUrl ?? authUiUrl,
  };
}
