function readOptionalValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

const injectedAuthBaseUrl = readOptionalValue(
  (globalThis as unknown as { __AUTH_BASE_URL__?: string }).__AUTH_BASE_URL__,
);

export const CONVEX_URL = readOptionalValue(import.meta.env.VITE_CONVEX_URL);

export const AUTH_BASE_URL =
  readOptionalValue(import.meta.env.VITE_AUTH_BASE_URL) ??
  injectedAuthBaseUrl ??
  (import.meta.env.DEV ? "http://localhost:3000" : undefined);

export const missingDesktopConfiguration = [
  !CONVEX_URL ? "VITE_CONVEX_URL" : null,
  !AUTH_BASE_URL ? "VITE_AUTH_BASE_URL" : null,
].filter((value): value is string => value !== null);
