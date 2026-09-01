import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from "react";

import { isJsonNumber } from "@chief/relay-contracts";

import type { StoredRelayConnection } from "../relay-connection";
import type { AuthState } from "./auth-state";
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
  forgetRelayConnection,
  forgetRelayWorkspaces,
  knownRelayConnections,
  rememberRelayConnection,
  resolveRelayConnection,
  saveStoredRelayConnection,
} from "../relay-connection";
import { useRelayWorkspaceOverride } from "../relay-workspace-override";
import { connectedRelayIdentities } from "./account-directory";
import {
  asError,
  chiefAccountConnection,
  openRelayAuthorization,
  validateOrRefreshSession,
} from "./auth-session-flow";
import {
  authClient,
  getActiveAuthOrganizationMember,
} from "./better-auth-client";
import { setupAuthDeepLink } from "./client";
import {
  AUTH_SESSION_CHANGED_EVENT,
  clearStoredRelaySession,
  clearStoredSession,
  getStoredSession,
  hydrateStoredSession,
  loadSessionForRelay,
  setStoredSession,
  storeSessionForRelay,
} from "./session";

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
  const currentStoredSession = useEffectEvent(() => storedSession);
  const [organizationMembership, setOrganizationMembership] = useState<{
    organizationId: string;
    role: OrganizationRole;
    token: string;
  } | null>(null);
  const authFlowCleanupRef = useRef<(() => void) | null>(null);
  const authFlowCompletedRef = useRef(false);

  useEffect(() => {
    const syncStoredSession = () => {
      setStoredSessionState(getStoredSession());
    };
    window.addEventListener(AUTH_SESSION_CHANGED_EVENT, syncStoredSession);
    void hydrateStoredSession()
      .then((session) => {
        setStoredSessionState(session);
        setSessionHydrated(true);
        // A persisted OAuth access token may have expired while Chief was
        // closed. Keep consumers behind the auth loading boundary until the
        // Better Auth session has been validated or refreshed, otherwise the
        // relay can race ahead and attempt device binding with the stale token.
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

  const failDesktopAuth = useCallback((err: Error) => {
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

  useEffect(() => {
    if (!sessionHydrated) return;
    const session = currentStoredSession();
    if (!session) return;
    const token = session.token;

    let cancelled = false;
    void validateOrRefreshSession(session)
      .then((result) => {
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
        setAuthError(null);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        console.error("[Auth] Could not validate the OAuth session:", error);
        setAuthError("Chief could not validate your sign-in. Try again.");
        setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
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
      setIsSigningIn(true);
      setAuthError(null);
      authFlowCleanupRef.current?.();
      authFlowCleanupRef.current = null;
      authFlowCompletedRef.current = false;
      await openRelayAuthorization({
        version: 1,
        relayUrl: relayOrigin,
        authBaseUrl,
        authUiUrl,
      });
    },
    [],
  );

  const signIn = useCallback(() => {
    void startRelayAuthorization(chiefAccountConnection).catch((error) =>
      failDesktopAuth(asError(error instanceof Error ? error : String(error))),
    );
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
        failDesktopAuth(
          asError(error instanceof Error ? error : String(error)),
        );
        throw error;
      }
    },
    [failDesktopAuth, startRelayAuthorization],
  );

  const signOut = useCallback((requestedRelayUrl?: string) => {
    authFlowCleanupRef.current?.();
    authFlowCleanupRef.current = null;
    authFlowCompletedRef.current = false;
    setIsSigningIn(false);
    setIsLoading(false);
    const activeRelayOrigin = new URL(RELAY_URL).origin;
    const relayOrigin = new URL(requestedRelayUrl ?? RELAY_URL).origin;
    const identity = connectedRelayIdentities().find(
      (candidate) => candidate.relayUrl === relayOrigin,
    );
    const accountId = identity?.user.id ?? null;
    const signsOutActiveRelay = relayOrigin === activeRelayOrigin;
    const remoteSignOut = signsOutActiveRelay
      ? authClient.signOut().catch((err) => {
          console.error("[Auth] Remote sign-out error:", err);
        })
      : Promise.resolve();
    if (signsOutActiveRelay) {
      clearStoredSession();
      setStoredSessionState(null);
    }
    void Promise.all([
      remoteSignOut,
      clearStoredRelaySession(relayOrigin),
    ]).finally(() => {
      if (accountId) forgetRelayWorkspaces(relayOrigin, accountId);
      if (relayOrigin !== chiefAccountConnection.relayUrl) {
        forgetRelayConnection(relayOrigin);
      }
      if (!signsOutActiveRelay) return;
      const fallback = connectedRelayIdentities()[0];
      if (!fallback) {
        saveStoredRelayConnection(null);
        return;
      }
      const connection = resolveRelayConnection(
        fallback.relayUrl,
        knownRelayConnections(),
        chiefAccountConnection,
      );
      if (!connection) {
        saveStoredRelayConnection(null);
        return;
      }
      if (connection.relayUrl === chiefAccountConnection.relayUrl) {
        saveStoredRelayConnection(null);
      } else {
        activateKnownRelay(connection.relayUrl);
      }
      window.location.assign("/");
    });
  }, []);

  const updateProfileImage = useCallback((image: string | null) => {
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
    return Promise.resolve();
  }, []);

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
