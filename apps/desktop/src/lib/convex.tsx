/**
 * Convex client for the desktop app.
 *
 * The desktop authenticates with better-auth via a stored bearer session
 * token (see ./auth). Convex needs a JWT, which the better-auth convex
 * plugin mints at GET /api/auth/convex/token for any authenticated session.
 * We wire ConvexProviderWithAuth to that endpoint instead of the web's
 * ConvexBetterAuthProvider, which assumes cookie-based useSession state.
 */

import { useCallback, useMemo } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { ConvexProviderWithAuth, ConvexReactClient } from "convex/react";

import { AUTH_BASE_URL } from "./auth/better-auth-client";
import { useAuth } from "./auth/auth-context";

const CONVEX_URL =
  (import.meta.env.VITE_CONVEX_URL as string | undefined) ??
  "https://colorful-mockingbird-638.convex.cloud";

export const convex = new ConvexReactClient(CONVEX_URL);

function useConvexAuthFromDesktop() {
  const { isAuthenticated, sessionToken } = useAuth();

  const fetchAccessToken = useCallback(async () => {
    if (!sessionToken) return null;
    try {
      // Tauri's native fetch bypasses webview CORS, same as the auth client.
      const fetcher = isTauri() ? tauriFetch : fetch;
      const response = await fetcher(`${AUTH_BASE_URL}/api/auth/convex/token`, {
        headers: { Authorization: `Bearer ${sessionToken}` },
      });
      if (!response.ok) return null;
      const data = (await response.json()) as { token?: string } | null;
      return data?.token ?? null;
    } catch (error) {
      console.error("[Convex] Failed to fetch access token:", error);
      return null;
    }
  }, [sessionToken]);

  return useMemo(
    () => ({
      isLoading: false,
      isAuthenticated,
      fetchAccessToken,
    }),
    [isAuthenticated, fetchAccessToken],
  );
}

export function ConvexClientProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ConvexProviderWithAuth client={convex} useAuth={useConvexAuthFromDesktop}>
      {children}
    </ConvexProviderWithAuth>
  );
}
