/**
 * Desktop OAuth session storage.
 *
 * Credentials live in macOS Keychain. The WebView keeps only an in-memory
 * copy after startup hydration; neither access nor refresh tokens are written
 * to localStorage.
 */

import { invoke, isTauri } from "@tauri-apps/api/core";

import {
  isJsonBoolean,
  isJsonNumber,
  isJsonObject,
  isJsonString,
  parseJsonValue,
} from "@chief/relay-contracts";

import { RELAY_URL } from "../config";
import {
  activeRelayUserId,
  forgetRelayIdentity,
  relayIdentity,
  rememberRelayAccount,
  secureSessionAccount,
} from "./account-directory";

const SESSION_KEY = "chief-auth-session";
const LEGACY_SESSION_KEY = "marketer-auth-session";
const BROWSER_SESSION_KEY = "chief-auth-session-memory";
const KEYCHAIN_READ_TIMEOUT_MS = 12_000;
export const AUTH_SESSION_CHANGED_EVENT = "chief:auth-session-changed";

let cachedSession: StoredSession | null = null;
let hydrated = false;
let persistenceQueue = Promise.resolve();

function enqueuePersistence(operation: () => Promise<void>) {
  persistenceQueue = persistenceQueue.catch(() => undefined).then(operation);
  void persistenceQueue.catch((error: unknown) => {
    console.error("[Auth] Secure OAuth session persistence failed:", error);
  });
}

function notifySessionChanged() {
  queueMicrotask(() =>
    window.dispatchEvent(new Event(AUTH_SESSION_CHANGED_EVENT)),
  );
}

export interface StoredSession {
  /** Short-lived OAuth access token issued by the selected relay. */
  token: string;
  /** Rotating credential used to obtain another access token. */
  refreshToken?: string;
  /** Access token expiry as Unix epoch milliseconds. */
  expiresAt?: number;
  /** User data from BetterAuth */
  user: {
    id: string;
    name: string;
    email: string;
    emailVerified: boolean;
    image?: string;
  };
  /** Active relay workspace projection, retained for UI restoration. */
  organizationId?: string;
  /** When this session was last validated against the server */
  lastValidated: number;
}

export function getStoredSession(): StoredSession | null {
  return cachedSession;
}

export function setStoredSession(session: StoredSession): void {
  cachedSession = session;
  const previousIdentity = relayIdentity(RELAY_URL);
  const identity = rememberRelayAccount(RELAY_URL, session.user);
  notifySessionChanged();
  enqueuePersistence(async () => {
    if (previousIdentity && previousIdentity.user.id !== identity.user.id) {
      await clearPersistedRelaySession(previousIdentity);
    }
    if (isTauri()) {
      await invoke("store_oauth_session", {
        account: secureSessionAccount(identity.relayUrl, identity.user.id),
        session,
      });
    } else {
      sessionStorage.setItem(
        browserSessionKey(identity.relayUrl, identity.user.id),
        JSON.stringify(session),
      );
    }
  });
}

export async function storeSessionForRelay(
  relayUrl: string,
  session: StoredSession,
): Promise<void> {
  const relayOrigin = new URL(relayUrl).origin;
  if (relayOrigin === new URL(RELAY_URL).origin) {
    setStoredSession(session);
    await persistenceQueue.catch(() => undefined);
    return;
  }
  const previousIdentity = relayIdentity(relayOrigin);
  const identity = rememberRelayAccount(relayOrigin, session.user);
  if (previousIdentity && previousIdentity.user.id !== identity.user.id) {
    await clearPersistedRelaySession(previousIdentity);
  }
  if (isTauri()) {
    await invoke("store_oauth_session", {
      account: secureSessionAccount(relayOrigin, identity.user.id),
      session,
    });
    return;
  }
  sessionStorage.setItem(
    browserSessionKey(relayOrigin, identity.user.id),
    JSON.stringify(session),
  );
}

export async function loadSessionForRelay(
  relayUrl: string,
  userId = activeRelayUserId(relayUrl),
): Promise<StoredSession | null> {
  const relayOrigin = new URL(relayUrl).origin;
  if (!userId) return loadLegacyRelaySession(relayOrigin);
  if (isTauri()) {
    const session = await invoke<StoredSession | null>("load_oauth_session", {
      account: secureSessionAccount(relayOrigin, userId),
    });
    return session ?? loadLegacyRelaySession(relayOrigin);
  }
  return parseSession(
    sessionStorage.getItem(browserSessionKey(relayOrigin, userId)),
  );
}

export function clearStoredSession(): void {
  const relayOrigin = new URL(RELAY_URL).origin;
  const activeUserId = cachedSession?.user.id ?? activeRelayUserId(relayOrigin);
  cachedSession = null;
  localStorage.removeItem(SESSION_KEY);
  localStorage.removeItem(LEGACY_SESSION_KEY);
  sessionStorage.removeItem(BROWSER_SESSION_KEY);
  notifySessionChanged();
  enqueuePersistence(async () => {
    if (isTauri()) {
      if (activeUserId) {
        await invoke("clear_oauth_session", {
          account: secureSessionAccount(relayOrigin, activeUserId),
        });
      }
      await invoke("clear_oauth_session", { account: relayOrigin });
      return;
    }
    if (activeUserId) {
      sessionStorage.removeItem(browserSessionKey(relayOrigin, activeUserId));
    }
  });
}

export async function clearStoredRelaySession(relayUrl: string): Promise<void> {
  const relayOrigin = new URL(relayUrl).origin;
  const identity = forgetRelayIdentity(relayOrigin);
  if (!identity) return;
  if (cachedSession && relayOrigin === new URL(RELAY_URL).origin) {
    cachedSession = null;
    notifySessionChanged();
  }
  await clearPersistedRelaySession(identity);
}

export async function hydrateStoredSession(): Promise<StoredSession | null> {
  if (hydrated) return cachedSession;
  await persistenceQueue.catch(() => undefined);

  let session: StoredSession | null = null;
  if (isTauri()) {
    session = await withTimeout(
      loadSessionForRelay(RELAY_URL),
      KEYCHAIN_READ_TIMEOUT_MS,
      "Chief could not read your secure sign-in. Open Chief again and allow Keychain access.",
    );
  } else {
    session = await loadSessionForRelay(RELAY_URL);
  }

  // Remove credentials left by pre-Keychain builds. A valid legacy session is
  // migrated once so upgrading does not unnecessarily sign the user out.
  const legacy =
    parseSession(localStorage.getItem(SESSION_KEY)) ??
    parseSession(localStorage.getItem(LEGACY_SESSION_KEY));
  localStorage.removeItem(SESSION_KEY);
  localStorage.removeItem(LEGACY_SESSION_KEY);
  session ??= legacy;

  hydrated = true;
  cachedSession = session;
  if (session) rememberRelayAccount(RELAY_URL, session.user);
  if (legacy && session === legacy) setStoredSession(legacy);
  else notifySessionChanged();
  return session;
}

async function loadLegacyRelaySession(
  relayOrigin: string,
): Promise<StoredSession | null> {
  if (isTauri()) {
    const legacy = await invoke<StoredSession | null>("load_oauth_session", {
      account: relayOrigin,
    });
    if (legacy) rememberRelayAccount(relayOrigin, legacy.user);
    return legacy;
  }
  return (
    parseSession(
      sessionStorage.getItem(`${BROWSER_SESSION_KEY}:${relayOrigin}`),
    ) ?? parseSession(sessionStorage.getItem(BROWSER_SESSION_KEY))
  );
}

function browserSessionKey(relayUrl: string, userId: string): string {
  return `${BROWSER_SESSION_KEY}:${new URL(relayUrl).origin}:${userId}`;
}

async function clearPersistedRelaySession(identity: {
  relayUrl: string;
  user: { id: string };
}): Promise<void> {
  if (isTauri()) {
    await invoke("clear_oauth_session", {
      account: secureSessionAccount(identity.relayUrl, identity.user.id),
    });
    return;
  }
  sessionStorage.removeItem(
    browserSessionKey(identity.relayUrl, identity.user.id),
  );
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function parseSession(raw: string | null): StoredSession | null {
  let value: ReturnType<typeof parseJsonValue> = null;
  try {
    value = raw ? parseJsonValue(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
  if (!isJsonObject(value) || !isJsonObject(value.user)) return null;
  const { user } = value;
  if (
    !isJsonString(value.token) ||
    !isJsonNumber(value.lastValidated) ||
    !isJsonString(user.id) ||
    !isJsonString(user.name) ||
    !isJsonString(user.email) ||
    !isJsonBoolean(user.emailVerified)
  ) {
    return null;
  }
  if (
    (value.refreshToken !== undefined && !isJsonString(value.refreshToken)) ||
    (value.expiresAt !== undefined && !isJsonNumber(value.expiresAt)) ||
    (value.organizationId !== undefined &&
      !isJsonString(value.organizationId)) ||
    (user.image !== undefined && !isJsonString(user.image))
  ) {
    return null;
  }
  const session: StoredSession = {
    token: value.token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      emailVerified: user.emailVerified,
    },
    lastValidated: value.lastValidated,
  };
  if (value.refreshToken !== undefined)
    session.refreshToken = value.refreshToken;
  if (value.expiresAt !== undefined) session.expiresAt = value.expiresAt;
  if (user.image !== undefined) session.user.image = user.image;
  if (value.organizationId !== undefined) {
    session.organizationId = value.organizationId;
  }
  return session;
}
