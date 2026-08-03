/**
 * Convex client for the desktop app.
 *
 * The desktop authenticates with better-auth via a stored bearer session
 * token (see ./auth). Convex needs a JWT, which the better-auth convex
 * plugin mints at GET /api/auth/convex/token for any authenticated session.
 * We wire ConvexProviderWithAuth to that endpoint instead of the web's
 * ConvexBetterAuthProvider, which assumes cookie-based useSession state.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { ConvexProviderWithAuth, ConvexReactClient } from "convex/react";

import { useAuth } from "./auth/auth-context";
import { AUTH_BASE_URL } from "./auth/better-auth-client";
import { CONVEX_URL } from "./config";
import { fetchWithTimeout } from "./fetch-with-timeout";

// App.tsx prevents an unconfigured build from rendering. This loopback URL
// exists only so imports remain side-effect safe before that check runs.
export const convex = new ConvexReactClient(
  CONVEX_URL ?? "http://127.0.0.1:3210",
);

const INITIAL_RETRY_MS = 500;
const MAX_RETRY_MS = 15_000;

function wait(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve) => {
    const timer = window.setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        window.clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

async function requestConvexAccessToken(sessionToken: string) {
  const fetcher = isTauri() ? tauriFetch : fetch;
  const response = await fetchWithTimeout(
    fetcher,
    `${AUTH_BASE_URL!}/api/auth/convex/token`,
    { headers: { Authorization: `Bearer ${sessionToken}` } },
  );

  if (response.status === 401 || response.status === 403) return null;
  if (!response.ok) {
    throw new Error(`Convex token request failed (${response.status})`);
  }

  const data = (await response.json()) as { token?: string } | null;
  if (!data?.token) throw new Error("Convex token response was empty");
  return data.token;
}

function useConvexAuthFromDesktop() {
  const {
    cloudOrganizationId,
    invalidateSession,
    isAuthenticated,
    sessionToken,
  } = useAuth();
  const tokenRef = useRef<string | null>(null);
  const [tokenReady, setTokenReady] = useState(false);

  // Convex treats a null token as a permanent loss of authentication. Do not
  // feed it a transient startup/network failure: establish one valid token
  // first and retry quietly until the auth service is reachable.
  useEffect(() => {
    tokenRef.current = null;
    setTokenReady(false);
    if (!isAuthenticated || !sessionToken) return;

    const controller = new AbortController();
    void (async () => {
      let retryMs = INITIAL_RETRY_MS;
      while (!controller.signal.aborted) {
        try {
          const token = await requestConvexAccessToken(sessionToken);
          if (controller.signal.aborted) return;
          if (token) {
            tokenRef.current = token;
            setTokenReady(true);
            return;
          }

          invalidateSession();
          return;
        } catch (error) {
          console.warn("[Convex] Access token not ready; retrying", error);
        }

        await wait(retryMs, controller.signal);
        retryMs = Math.min(retryMs * 2, MAX_RETRY_MS);
      }
    })();

    return () => controller.abort();
  }, [cloudOrganizationId, invalidateSession, isAuthenticated, sessionToken]);

  const fetchAccessToken = useCallback(async () => {
    if (!sessionToken) return null;

    try {
      const token = await requestConvexAccessToken(sessionToken);
      if (token) {
        tokenRef.current = token;
      } else {
        invalidateSession();
      }
      return token;
    } catch (error) {
      // During a refresh, keep using the last server-issued token. Convex will
      // ask again as needed, while the preflight loop handles cold starts.
      console.warn("[Convex] Token refresh failed; using cached token", error);
      return tokenRef.current;
    }
  }, [cloudOrganizationId, invalidateSession, sessionToken]);

  return useMemo(
    () => ({
      isLoading: isAuthenticated && !tokenReady,
      isAuthenticated: isAuthenticated && tokenReady,
      fetchAccessToken,
    }),
    [isAuthenticated, tokenReady, fetchAccessToken],
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
