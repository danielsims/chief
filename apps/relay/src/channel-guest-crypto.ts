import { HttpError } from "./http";
import {
  decryptSecret,
  deriveKey,
  encryptSecret,
} from "./workspace-secret-store";

export const GUEST_CREDENTIAL_HEADER = "x-chief-guest-credential";
export const GUEST_TOKEN_PREFIX = "chg_";

const approvalAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function randomBase64Url(bytes = 32) {
  const values = crypto.getRandomValues(new Uint8Array(bytes));
  let binary = "";
  for (const value of values) binary += String.fromCharCode(value);
  return btoa(binary)
    .replace(/\+/gu, "-")
    .replace(/\//gu, "_")
    .replace(/=+$/gu, "");
}

export function newGuestToken() {
  return `${GUEST_TOKEN_PREFIX}${randomBase64Url(32)}`;
}

export function newGuestId() {
  return `guest_${randomBase64Url(12)}`;
}

/** Eight unambiguous characters, shown to the sponsor as `ABCD-EFGH`. */
export function newApprovalCode() {
  const values = crypto.getRandomValues(new Uint8Array(8));
  const characters = [...values].map(
    (value) => approvalAlphabet[value % approvalAlphabet.length],
  );
  return `${characters.slice(0, 4).join("")}-${characters.slice(4).join("")}`;
}

export function normalizeApprovalCode(value: string) {
  const compact = value.toUpperCase().replace(/[^A-Z0-9]/gu, "");
  if (compact.length !== 8) return null;
  return `${compact.slice(0, 4)}-${compact.slice(4)}`;
}

export async function sha256Hex(value: string) {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function guestTokenFrom(value: string | null) {
  const token = value?.startsWith("Bearer ")
    ? value.slice("Bearer ".length).trim()
    : (value?.trim() ?? "");
  return /^chg_[A-Za-z0-9_-]{43}$/u.test(token) ? token : null;
}

let cachedKey: { master: string; key: Promise<CryptoKey> } | undefined;

function sealingKey(master: string) {
  if (!master || master.length < 16) {
    throw new Error("Guest credentials require a strong RELAY_SECRET_KEY.");
  }
  if (cachedKey?.master !== master) {
    cachedKey = { master, key: deriveKey(master) };
  }
  return cachedKey.key;
}

export async function seal(master: string, plaintext: string) {
  return encryptSecret(await sealingKey(master), plaintext);
}

export async function unseal(master: string, sealed: string) {
  return decryptSecret(await sealingKey(master), sealed);
}

/** A `whsec_` Standard Webhooks key with 32 random bytes. */
export function newWebhookSecret() {
  const values = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const value of values) binary += String.fromCharCode(value);
  return `whsec_${btoa(binary)}`;
}

export function requireWebhookSecret(value: string) {
  const encoded = value.startsWith("whsec_") ? value.slice(6) : "";
  let length = 0;
  try {
    length = atob(encoded).length;
  } catch {
    length = 0;
  }
  if (length < 24 || length > 64) {
    throw new HttpError(
      400,
      "invalid_webhook_secret",
      "Expected a whsec_ secret whose base64 value decodes to 24–64 bytes.",
    );
  }
  return value;
}

/** Standard Webhooks signature: `v1,base64(HMAC-SHA256(id.timestamp.body))`. */
export async function signStandardWebhook(
  secret: string,
  id: string,
  timestamp: number,
  body: string,
) {
  const raw = Uint8Array.from(atob(secret.replace(/^whsec_/u, "")), (char) =>
    char.charCodeAt(0),
  );
  const key = await crypto.subtle.importKey(
    "raw",
    raw,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(`${id}.${timestamp}.${body}`),
    ),
  );
  let binary = "";
  for (const byte of signature) binary += String.fromCharCode(byte);
  return `v1,${btoa(binary)}`;
}

const blockedHostnames = /(^|\.)(localhost|local|internal|lan|home|corp)$/u;

/** Outbound wake-ups only reach public HTTPS hosts on the default port. */
export function requirePublicHttpsUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw invalidDestination();
  }
  const hostname = url.hostname.toLowerCase().replace(/\.$/u, "");
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port !== "" && url.port !== "443") ||
    !hostname.includes(".") ||
    blockedHostnames.test(hostname) ||
    isIpLiteral(hostname)
  ) {
    throw invalidDestination();
  }
  return url.toString();
}

function isIpLiteral(hostname: string) {
  return hostname.startsWith("[") || /^\d{1,3}(\.\d{1,3}){3}$/u.test(hostname);
}

function invalidDestination() {
  return new HttpError(
    400,
    "invalid_webhook_url",
    "Webhooks must use a public HTTPS hostname on the default port.",
  );
}
