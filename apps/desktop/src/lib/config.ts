import { env } from "../env";

function readOptionalValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

const injectedAuthBaseUrl = readOptionalValue(
  (globalThis as unknown as { __AUTH_BASE_URL__?: string }).__AUTH_BASE_URL__,
);

export const CONVEX_URL = env.VITE_CONVEX_URL;

export const AUTH_UI_BASE_URL =
  env.VITE_AUTH_UI_URL ??
  env.VITE_AUTH_BASE_URL ??
  injectedAuthBaseUrl ??
  (import.meta.env.DEV ? "http://localhost:3000" : "https://heychief.sh");

export const RELAY_URL =
  env.VITE_CHIEF_RELAY_URL ??
  "https://chief-relay.danielsims-browser-ui.workers.dev";

export const AUTH_BASE_URL = RELAY_URL;

export const missingDesktopConfiguration = [
  !CONVEX_URL ? "VITE_CONVEX_URL" : null,
  !AUTH_UI_BASE_URL ? "VITE_AUTH_UI_URL" : null,
].filter((value): value is string => value !== null);
