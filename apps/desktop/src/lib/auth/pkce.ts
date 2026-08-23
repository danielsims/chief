/**
 * PKCE Utilities for Desktop Auth
 *
 * Implements the Proof Key for Code Exchange (PKCE) flow using Web Crypto API.
 * Used to securely authenticate the desktop app via the system browser.
 */

import { invoke, isTauri } from "@tauri-apps/api/core";

export interface PkceAttempt {
  state: string;
  verifier: string;
  relayOrigin: string;
  authBaseUrl: string;
  createdAt: number;
}

const verifierStore = new Map<string, PkceAttempt>();

// Clean up verifiers older than 10 minutes
const VERIFIER_TTL_MS = 10 * 60 * 1000;

function cleanupExpiredVerifiers() {
  const now = Date.now();
  for (const [state, entry] of verifierStore) {
    if (now - entry.createdAt > VERIFIER_TTL_MS) {
      verifierStore.delete(state);
    }
  }
}

/**
 * Generate a random state string (32 hex characters).
 */
export function generateState(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Generate a code_verifier (32 random bytes, base64url encoded).
 */
export function generateCodeVerifier(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

/**
 * Generate a code_challenge from a code_verifier using SHA-256.
 */
export async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoded = new TextEncoder().encode(verifier);
  const hash = await crypto.subtle.digest("SHA-256", encoded);
  return base64UrlEncode(new Uint8Array(hash));
}

/**
 * Store a PKCE verifier keyed by state.
 */
export async function storePkceVerifier(
  state: string,
  verifier: string,
  context: Pick<PkceAttempt, "relayOrigin" | "authBaseUrl">,
): Promise<void> {
  cleanupExpiredVerifiers();
  const attempt = { state, verifier, ...context, createdAt: Date.now() };
  verifierStore.set(state, attempt);
  if (isTauri()) await invoke("store_oauth_attempt", { attempt });
}

/**
 * Retrieve a PKCE verifier by state without consuming it.
 * Returns null if not found or expired. Call clearPkceVerifier() after a
 * successful exchange — deleting on read would make the flow single-shot,
 * so a transient failure on the polling path would permanently kill the
 * deep-link retry for the same state.
 */
export async function getPkceAttempt(
  state: string,
): Promise<PkceAttempt | null> {
  cleanupExpiredVerifiers();
  const inMemory = verifierStore.get(state);
  if (inMemory) return inMemory;
  if (!isTauri()) return null;
  const persisted = await invoke<PkceAttempt | null>("load_oauth_attempt", {
    state,
  });
  if (persisted) verifierStore.set(state, persisted);
  return persisted;
}

/** Remove a verifier once its exchange has completed successfully. */
export async function clearPkceVerifier(state: string): Promise<void> {
  verifierStore.delete(state);
  if (isTauri()) await invoke("clear_oauth_attempt", { state });
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function base64UrlEncode(bytes: Uint8Array): string {
  const binary = Array.from(bytes, (b) => String.fromCharCode(b)).join("");
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
