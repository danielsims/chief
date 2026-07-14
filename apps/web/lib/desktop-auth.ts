/**
 * Desktop Auth helpers — shared constants and CORS utilities
 * for the desktop OAuth flow.
 */

import { env } from "./env";

const DESKTOP_ORIGINS = [
  "http://localhost:1420", // Tauri dev (Vite)
  "tauri://localhost", // Tauri production (macOS)
  "https://tauri.localhost", // Tauri production (Windows)
];

export const DEEP_LINK_SCHEME = "chief-desktop";

/**
 * Returns CORS headers if the request origin is a known desktop origin.
 * Returns empty object for unknown origins (blocks the request).
 */
export function desktopCorsHeaders(
  origin: string | null,
): Record<string, string> {
  if (!origin || !DESKTOP_ORIGINS.includes(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

/**
 * Derive the Convex HTTP actions (site) URL from env.
 * Auth API requests go to the Convex backend, not the Next.js server.
 */
export function getConvexSiteUrl(): string {
  const convexUrl = env.NEXT_PUBLIC_CONVEX_URL;
  return (
    env.NEXT_PUBLIC_CONVEX_SITE_URL ??
    convexUrl.replace(".convex.cloud", ".convex.site")
  );
}
