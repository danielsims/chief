/**
 * Desktop Session Storage
 *
 * Stores the auth session in localStorage (for the WebView / React app).
 *
 * The reference implementation also mirrors the session into a
 * cli-identity.json file via a Tauri command so background workers can
 * authenticate. That Rust command doesn't exist here yet — see the TODOs.
 */

const SESSION_KEY = "marketer-auth-session";

export interface StoredSession {
  /** BetterAuth session token */
  token: string;
  /** User data from BetterAuth */
  user: {
    id: string;
    name: string;
    email: string;
    emailVerified: boolean;
    image?: string;
  };
  /** Active organization ID from BetterAuth session */
  organizationId?: string;
  /** When this session was last validated against the server */
  lastValidated: number;
}

export function getStoredSession(): StoredSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredSession;
    if (!parsed.token || !parsed.user?.id) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function setStoredSession(session: StoredSession): void {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));

  // TODO: mirror the session into a cli-identity.json file for background
  // workers once a `write_cli_identity` Tauri command exists (see the
  // reference implementation in program/apps/desktop). No-op for now.
}

export function clearStoredSession(): void {
  localStorage.removeItem(SESSION_KEY);

  // TODO: clear the cli-identity.json file once a `clear_cli_identity`
  // Tauri command exists. No-op for now.
}
