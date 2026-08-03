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

import type { OrganizationRole } from "./organization-role";
import type { StoredSession } from "./session";
import {
  AUTH_BASE_URL,
  authClient,
  getActiveAuthOrganizationMember,
  updateAuthUser,
  validateStoredSession,
} from "./better-auth-client";
import { pollForDesktopPkce, setupAuthDeepLink } from "./client";
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
  setStoredSession,
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
  signOut: () => void;
  invalidateSession: () => void;
  updateProfileImage: (image: string | null) => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [isLoading, setIsLoading] = useState(() =>
    Boolean(getStoredSession()?.token),
  );
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [storedSession, setStoredSessionState] = useState<StoredSession | null>(
    () => getStoredSession(),
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
  const completeDesktopAuth = useCallback((storedSession: StoredSession) => {
    if (authFlowCompletedRef.current) return;
    authFlowCompletedRef.current = true;
    authFlowCleanupRef.current?.();
    authFlowCleanupRef.current = null;
    console.log("[Auth] Desktop session received");
    setStoredSession(storedSession);
    setStoredSessionState(storedSession);
    setAuthError(null);
    setIsSigningIn(false);
    setIsLoading(false);
    // A fresh sign-in always lands on the dashboard. The webview URL still
    // holds whatever route the user signed out from (e.g. /settings), and
    // the router would otherwise restore it when it remounts.
    window.history.replaceState(null, "", "/");
  }, []);

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

  // Validate the cached session against the server once when it changes (app
  // launch, and again right after sign-in). The localStorage session can
  // outlive the server-side session — it expires, or a backend auth deploy
  // invalidates old tokens. Without this the app shows a signed-in UI while
  // every authenticated cloud call silently 401s. This is a single request per
  // token (NOT polling); when the server rejects the token we sign out locally
  // so the user gets a clear re-login prompt instead of a half-broken session.
  useEffect(() => {
    const token = storedSession?.token;
    if (!token) {
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    void validateStoredSession(token).then((result) => {
      if (cancelled) return;
      if (result.status === "invalid") {
        console.warn("[Auth] Stored session rejected by server, signing out");
        invalidateSession();
        return;
      }
      if (result.status !== "valid") {
        setIsLoading(false);
        return;
      }

      setStoredSessionState((current) => {
        if (!current || current.token !== token) return current;
        const next = {
          ...current,
          user: result.user,
          organizationId: result.organizationId ?? current.organizationId,
          lastValidated: Date.now(),
        };
        setStoredSession(next);
        return next;
      });
      setIsLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [invalidateSession, storedSession?.token]);

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

  const signIn = useCallback(async () => {
    console.log("[Auth] signIn called, starting PKCE flow");
    setIsSigningIn(true);
    setAuthError(null);
    authFlowCleanupRef.current?.();
    authFlowCleanupRef.current = null;
    authFlowCompletedRef.current = false;
    try {
      const state = generateState();
      const codeVerifier = generateCodeVerifier();
      const codeChallenge = await generateCodeChallenge(codeVerifier);

      storePkceVerifier(state, codeVerifier);

      authFlowCleanupRef.current = await pollForDesktopPkce(state, {
        onSession: completeDesktopAuth,
        onError: failDesktopAuth,
      });

      const signInUrl = new URL(`${AUTH_BASE_URL}/sign-in`);
      signInUrl.searchParams.set("client_id", "chief-desktop");
      signInUrl.searchParams.set("code_challenge", codeChallenge);
      signInUrl.searchParams.set("code_challenge_method", "S256");
      signInUrl.searchParams.set("state", state);

      console.log(
        "[Auth] Opening browser for PKCE OAuth:",
        signInUrl.toString().substring(0, 100) + "...",
      );
      await openUrl(signInUrl.toString());
    } catch (err) {
      failDesktopAuth(err);
    }
  }, [completeDesktopAuth, failDesktopAuth]);

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
      signOut,
      invalidateSession,
      updateProfileImage,
    }),
    [
      authError,
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
      signIn: () => {},
      signOut: () => {},
      invalidateSession: () => {},
      updateProfileImage: async () => {},
    };
  }
  return ctx;
}
