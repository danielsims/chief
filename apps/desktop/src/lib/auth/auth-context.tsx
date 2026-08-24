/**
 * Desktop Auth Context
 *
 * Uses PKCE-based authentication flow:
 * - Generates PKCE challenge and opens system browser
 * - Deep link handler or dev-mode polling receives authorization code
 * - Exchanges code for session token via /desktop/token endpoint
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { openUrl } from "@tauri-apps/plugin-opener";

import { isJsonNumber } from "@chief/relay-contracts";

import type { StoredRelayConnection } from "../relay-connection";
import type { OrganizationRole } from "./organization-role";
import type { StoredSession } from "./session";
import {
  AUTH_BASE_URL,
  AUTH_UI_BASE_URL,
  CHIEF_CLOUD_RELAY_URL,
  RELAY_URL,
} from "../config";
import {
  activateKnownRelay,
  rememberRelayConnection,
  saveStoredRelayConnection,
} from "../relay-connection";
import { useRelayWorkspaceOverride } from "../relay-workspace-override";
import {
  authClient,
  getActiveAuthOrganizationMember,
  updateAuthUser,
  validateStoredSession,
} from "./better-auth-client";
import { refreshOAuthSession, setupAuthDeepLink } from "./client";
import { shouldInvalidateOAuthSession } from "./oauth-token-error";
import {
  generateCodeChallenge,
  generateCodeVerifier,
  generateState,
  storePkceVerifier,
} from "./pkce";
import {
  AUTH_SESSION_CHANGED_EVENT,
  clearStoredSession,
  getStoredSession,
  hydrateStoredSession,
  loadSessionForRelay,
  setStoredSession,
  storeSessionForRelay,
} from "./session";

interface AuthState {
  isLoading: boolean;
  isSigningIn: boolean;
  isAuthenticated: boolean;
  sessionToken: string | null;
  user: {
    id: string;
    name: string;
    email: string;
    emailVerified: boolean;
    image?: string;
  } | null;
  cloudOrganizationId: string | null;
  organizationRole: OrganizationRole | null;
  /** Last sign-in failure, surfaced on the splash screen. */
  authError: string | null;
  signIn: () => void;
  connectRelay: (connection: StoredRelayConnection) => Promise<void>;
  signOut: () => void;
  invalidateSession: () => void;
  updateProfileImage: (image: string | null) => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);
const noAuthAction = () => undefined;
const noAsyncAuthAction = () => Promise.resolve();

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [isLoading, setIsLoading] = useState(true);
  const [sessionHydrated, setSessionHydrated] = useState(false);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [validationTrigger, setValidationTrigger] = useState(0);
  const [storedSession, setStoredSessionState] = useState<StoredSession | null>(
    null,
  );
  const [organizationMembership, setOrganizationMembership] = useState<{
    organizationId: string;
    role: OrganizationRole;
    token: string;
  } | null>(null);
  const authFlowCleanupRef = useRef<(() => void) | null>(null);
  const authFlowCompletedRef = useRef(false);

  useEffect(() => {
    const syncStoredSession = () => setStoredSessionState(getStoredSession());
    window.addEventListener(AUTH_SESSION_CHANGED_EVENT, syncStoredSession);
    void hydrateStoredSession()
      .then((session) => {
        setStoredSessionState(session);
        setSessionHydrated(true);
        if (!session) setIsLoading(false);
      })
      .catch((error: unknown) => {
        console.error("[Auth] Could not load the secure OAuth session:", error);
        setAuthError(
          "Chief could not read your secure sign-in. Sign in again.",
        );
        setSessionHydrated(true);
        setIsLoading(false);
      });
    return () =>
      window.removeEventListener(AUTH_SESSION_CHANGED_EVENT, syncStoredSession);
  }, []);

  const invalidateSession = useCallback(() => {
    authFlowCleanupRef.current?.();
    authFlowCleanupRef.current = null;
    authFlowCompletedRef.current = false;
    clearStoredSession();
    setStoredSessionState(null);
    setIsSigningIn(false);
    setIsLoading(false);
    setAuthError("Your session expired. Sign in again.");
  }, []);

  // Deep link handler — receives chief-desktop:///auth#token=xxx
  // from the success page, exchanges the PKCE code for a session token.
  const completeDesktopAuth = useCallback(
    async (storedSession: StoredSession, relayOrigin: string) => {
      if (authFlowCompletedRef.current) return;
      authFlowCompletedRef.current = true;
      authFlowCleanupRef.current?.();
      authFlowCleanupRef.current = null;
      console.log("[Auth] Desktop session received");
      await storeSessionForRelay(relayOrigin, storedSession);

      if (new URL(relayOrigin).origin !== new URL(RELAY_URL).origin) {
        if (
          new URL(relayOrigin).origin === new URL(CHIEF_CLOUD_RELAY_URL).origin
        ) {
          saveStoredRelayConnection(null);
        } else {
          activateKnownRelay(relayOrigin);
        }
        window.location.assign("/");
        return;
      }

      setStoredSessionState(storedSession);
      setAuthError(null);
      setIsSigningIn(false);
      setIsLoading(false);
      // A fresh sign-in always lands on the dashboard. The webview URL still
      // holds whatever route the user signed out from (e.g. /settings), and
      // the router would otherwise restore it when it remounts.
      window.history.replaceState(null, "", "/");
    },
    [],
  );

  const failDesktopAuth = useCallback((err: unknown) => {
    // A late failure from the losing delivery path (poll vs deep link)
    // must not clobber an already-completed sign-in.
    if (authFlowCompletedRef.current) return;
    console.error("[Auth] Desktop auth error:", err);
    authFlowCleanupRef.current?.();
    authFlowCleanupRef.current = null;
    setAuthError(err instanceof Error ? err.message : String(err));
    setIsSigningIn(false);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    void setupAuthDeepLink({
      onSession: completeDesktopAuth,
      onError: failDesktopAuth,
    }).then((fn) => {
      cleanup = fn;
    });
    return () => cleanup?.();
  }, [completeDesktopAuth, failDesktopAuth]);

  useEffect(() => {
    const refreshExpiredSession = () => {
      if (
        document.visibilityState === "visible" &&
        isJsonNumber(storedSession?.expiresAt) &&
        storedSession.expiresAt <= Date.now() + 60_000
      ) {
        setValidationTrigger((current) => current + 1);
      }
    };
    window.addEventListener("focus", refreshExpiredSession);
    document.addEventListener("visibilitychange", refreshExpiredSession);
    return () => {
      window.removeEventListener("focus", refreshExpiredSession);
      document.removeEventListener("visibilitychange", refreshExpiredSession);
    };
  }, [storedSession?.expiresAt]);

  // Validate the cached session against the server once when it changes (app
  // launch, and again right after sign-in). The localStorage session can
  // outlive the server-side session — it expires, or a backend auth deploy
  // invalidates old tokens. Without this the app shows a signed-in UI while
  // every authenticated cloud call silently 401s. This is a single request per
  // token (NOT polling); when the server rejects the token we sign out locally
  // so the user gets a clear re-login prompt instead of a half-broken session.
  useEffect(() => {
    if (!sessionHydrated) return;
    const token = storedSession?.token;
    if (!token) {
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    // Only the first hydration blocks the application shell. A focus-triggered
    // refresh must keep the authenticated tree mounted so returning to Chief
    // never resets navigation, scroll position, or arrival animations.
    setIsLoading(false);
    void validateOrRefreshSession(storedSession).then((result) => {
      if (cancelled) return;
      if (!result) {
        console.warn("[Auth] Stored session rejected by server, signing out");
        invalidateSession();
        return;
      }

      setStoredSessionState((current) => {
        if (!current || current.token !== token) return current;
        const next = result;
        setStoredSession(next);
        return next;
      });
      setIsLoading(false);
    });
    return () => {
      cancelled = true;
    };
    // The access token is the validation identity. Depending on the whole
    // session would retrigger after updating lastValidated with the same token.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    invalidateSession,
    sessionHydrated,
    storedSession?.token,
    validationTrigger,
  ]);

  useEffect(() => {
    const organizationId = storedSession?.organizationId;
    const token = storedSession?.token;
    if (!token || !organizationId) return;
    let cancelled = false;
    void getActiveAuthOrganizationMember(organizationId)
      .then((member) => {
        if (!cancelled && member) {
          setOrganizationMembership({
            organizationId,
            role: member.role,
            token,
          });
        }
      })
      .catch((error: unknown) => {
        console.warn("[Auth] Could not resolve organization role:", error);
      });
    return () => {
      cancelled = true;
    };
  }, [storedSession?.organizationId, storedSession?.token]);

  // ─── Actions ─────────────────────────────────────────────────────────

  const startRelayAuthorization = useCallback(
    async (connection?: StoredRelayConnection) => {
      const relayOrigin = connection?.relayUrl ?? RELAY_URL;
      const authBaseUrl = connection?.authBaseUrl ?? AUTH_BASE_URL;
      const authUiUrl = connection?.authUiUrl ?? AUTH_UI_BASE_URL;
      console.log("[Auth] signIn called, starting PKCE flow");
      setIsSigningIn(true);
      setAuthError(null);
      authFlowCleanupRef.current?.();
      authFlowCleanupRef.current = null;
      authFlowCompletedRef.current = false;
      const state = generateState();
      const codeVerifier = generateCodeVerifier();
      const codeChallenge = await generateCodeChallenge(codeVerifier);

      await storePkceVerifier(state, codeVerifier, {
        relayOrigin,
        authBaseUrl,
      });

      const signInUrl = new URL("/api/auth/oauth2/authorize", authUiUrl);
      signInUrl.searchParams.set("client_id", "chief-desktop");
      signInUrl.searchParams.set("redirect_uri", "chief-desktop:///auth");
      signInUrl.searchParams.set("response_type", "code");
      signInUrl.searchParams.set(
        "scope",
        "openid profile email offline_access",
      );
      signInUrl.searchParams.set("code_challenge", codeChallenge);
      signInUrl.searchParams.set("code_challenge_method", "S256");
      signInUrl.searchParams.set("state", state);
      signInUrl.searchParams.set("resource", authBaseUrl);

      console.log(
        "[Auth] Opening browser for PKCE OAuth:",
        signInUrl.toString().substring(0, 100) + "...",
      );
      await openUrl(signInUrl.toString());
    },
    [],
  );

  const signIn = useCallback(() => {
    void startRelayAuthorization().catch(failDesktopAuth);
  }, [failDesktopAuth, startRelayAuthorization]);

  const connectRelay = useCallback(
    async (connection: StoredRelayConnection) => {
      rememberRelayConnection(connection);
      const existing = await loadSessionForRelay(connection.relayUrl);
      const reusable =
        existing &&
        (!isJsonNumber(existing.expiresAt) ||
          existing.expiresAt > Date.now() + 60_000 ||
          Boolean(existing.refreshToken));
      if (reusable) {
        // A stored refresh token is enough to switch relays. Let the normal
        // startup validation refresh it in place instead of opening a new
        // browser authorization flow while the user is simply pressing Back.
        activateKnownRelay(connection.relayUrl);
        window.location.assign("/");
        return;
      }
      try {
        await startRelayAuthorization(connection);
      } catch (error) {
        failDesktopAuth(error);
        throw error;
      }
    },
    [failDesktopAuth, startRelayAuthorization],
  );

  const signOut = useCallback(() => {
    authFlowCleanupRef.current?.();
    authFlowCleanupRef.current = null;
    authFlowCompletedRef.current = false;
    setIsSigningIn(false);
    setIsLoading(false);
    const remoteSignOut = authClient.signOut().catch((err) => {
      console.error("[Auth] Remote sign-out error:", err);
    });
    clearStoredSession();
    setStoredSessionState(null);

    void remoteSignOut;
  }, []);

  const updateProfileImage = useCallback(async (image: string | null) => {
    await updateAuthUser({ image });
    setStoredSessionState((current) => {
      if (!current) return current;
      const next: StoredSession = {
        ...current,
        user: {
          ...current.user,
          ...(image ? { image } : { image: undefined }),
        },
        lastValidated: Date.now(),
      };
      setStoredSession(next);
      return next;
    });
  }, []);

  // ─── Context Value ───────────────────────────────────────────────────

  const user = storedSession?.user ?? null;
  const organizationRole =
    organizationMembership &&
    organizationMembership.token === storedSession?.token &&
    organizationMembership.organizationId === storedSession.organizationId
      ? organizationMembership.role
      : null;

  const value = useMemo<AuthState>(
    () => ({
      isLoading,
      isSigningIn,
      isAuthenticated: Boolean(storedSession?.token && user),
      sessionToken: storedSession?.token ?? null,
      user: user
        ? {
            id: user.id,
            name: user.name,
            email: user.email,
            emailVerified: user.emailVerified,
            image: user.image ?? undefined,
          }
        : null,
      cloudOrganizationId: storedSession?.organizationId ?? null,
      organizationRole,
      authError,
      signIn,
      connectRelay,
      signOut,
      invalidateSession,
      updateProfileImage,
    }),
    [
      authError,
      connectRelay,
      isLoading,
      isSigningIn,
      invalidateSession,
      organizationRole,
      signIn,
      signOut,
      storedSession,
      updateProfileImage,
      user,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

async function validateOrRefreshSession(session: StoredSession) {
  const shouldRefresh =
    Boolean(session.refreshToken) &&
    isJsonNumber(session.expiresAt) &&
    session.expiresAt <= Date.now() + 60_000;
  if (shouldRefresh) {
    try {
      return await refreshOAuthSession(session);
    } catch (error) {
      return shouldInvalidateOAuthSession(error) ? null : session;
    }
  }
  const validation = await validateStoredSession(session.token);
  if (validation.status === "valid") {
    return {
      ...session,
      user: validation.user,
      organizationId: validation.organizationId ?? session.organizationId,
      lastValidated: Date.now(),
    };
  }
  if (validation.status === "unknown") return session;
  if (!session.refreshToken) return null;
  try {
    return await refreshOAuthSession(session);
  } catch (error) {
    return shouldInvalidateOAuthSession(error) ? null : session;
  }
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  const relayWorkspaceId = useRelayWorkspaceOverride();
  if (!ctx) {
    return {
      isLoading: false,
      isSigningIn: false,
      isAuthenticated: false,
      sessionToken: null,
      user: null,
      cloudOrganizationId: null,
      organizationRole: null,
      authError: null,
      signIn: noAuthAction,
      connectRelay: noAsyncAuthAction,
      signOut: noAuthAction,
      invalidateSession: noAuthAction,
      updateProfileImage: noAsyncAuthAction,
    };
  }
  return relayWorkspaceId
    ? { ...ctx, cloudOrganizationId: relayWorkspaceId }
    : ctx;
}
