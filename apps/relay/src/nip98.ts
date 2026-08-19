import { schnorr } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";

import { AuthenticationError } from "./auth";

/**
 * NIP-98 HTTP auth (kind 27235) verification for the relay.
 *
 * Every request carries an ephemeral nostr event in the Authorization header:
 *
 *   Authorization: Nostr <base64(event)>
 *
 * The event MUST be kind 27235, signed over its id with secp256k1 (BIP-340
 * Schnorr), within a 60s created_at window, and bound to the exact absolute URL
 * and HTTP method via `u` and `method` tags. POST bodies may add a `payload`
 * tag carrying the SHA-256 of the body so the relay can reject tampered bodies.
 *
 * Verification never contacts an external issuer or JWKS — the pubkey is the
 * identity and the signature proves possession of its private key.
 */

export const NIP98_EVENT_KIND = 27235;
export const NIP98_MAX_AGE_SECONDS = 60;

export interface Nip98Event {
  id: string;
  pubkey: string;
  content: string;
  kind: number;
  created_at: number;
  tags: string[][];
  sig: string;
}

export interface VerifyNip98Options {
  url: string;
  method: string;
  now?: number;
  /** Request body, when the event carries a `payload` (sha256) tag. */
  body?: string | null;
}

export function verifyNip98Auth(
  authorization: string | null,
  options: VerifyNip98Options,
): string {
  if (!authorization) {
    throw new AuthenticationError("A Nostr Authorization header is required.");
  }
  const scheme = authorization.slice(0, 5).toLowerCase();
  if (scheme !== "nostr") {
    throw new AuthenticationError("The Authorization scheme must be Nostr.");
  }
  const encoded = authorization.slice(5).trim();
  let event: Nip98Event;
  try {
    event = JSON.parse(decodeBase64(encoded)) as Nip98Event;
  } catch {
    throw new AuthenticationError("The Nostr event is not valid base64 JSON.");
  }

  const now = options.now ?? Math.floor(Date.now() / 1000);

  if (event.kind !== NIP98_EVENT_KIND) {
    throw new AuthenticationError(
      `The Nostr event kind must be ${NIP98_EVENT_KIND}.`,
    );
  }
  if (!Number.isInteger(event.created_at)) {
    throw new AuthenticationError("The Nostr event timestamp is invalid.");
  }
  if (Math.abs(now - event.created_at) > NIP98_MAX_AGE_SECONDS) {
    throw new AuthenticationError("The Nostr event has expired.");
  }
  const urlTag = tag(event.tags, "u");
  if (!urlTag || urlTag !== options.url) {
    throw new AuthenticationError(
      "The Nostr event is not bound to this request URL.",
    );
  }
  const methodTag = tag(event.tags, "method");
  if (methodTag?.toUpperCase() !== options.method.toUpperCase()) {
    throw new AuthenticationError(
      "The Nostr event is not bound to this HTTP method.",
    );
  }
  const payloadTag = tag(event.tags, "payload");
  if (payloadTag) {
    if (options.body === undefined) {
      throw new AuthenticationError(
        "The Nostr event binds a payload, but the request body was not checked.",
      );
    }
    if (!/^[0-9a-f]{64}$/u.test(payloadTag)) {
      throw new AuthenticationError("The Nostr payload tag is invalid.");
    }
    if (payloadTag !== sha256PayloadTag(options.body)) {
      throw new AuthenticationError(
        "The request body does not match the Nostr payload hash.",
      );
    }
  }
  if (!/^[0-9a-f]{64}$/u.test(event.id)) {
    throw new AuthenticationError("The Nostr event id is invalid.");
  }
  if (!/^[0-9a-f]{64}$/u.test(event.pubkey)) {
    throw new AuthenticationError("The Nostr event pubkey is invalid.");
  }
  if (!/^[0-9a-f]{128}$/u.test(event.sig)) {
    throw new AuthenticationError("The Nostr event signature is invalid.");
  }

  const ok = schnorr.verify(
    hexToBytes(event.sig),
    hexToBytes(event.id),
    hexToBytes(event.pubkey),
  );
  if (!ok) {
    throw new AuthenticationError("The Nostr event signature is invalid.");
  }
  return event.pubkey;
}

/** SHA-256 payload tag for POST bodies (hex). */
export function sha256PayloadTag(body: string | null | undefined): string {
  const source = body ?? "";
  return bytesToHex(sha256(new TextEncoder().encode(source)));
}

function tag(tags: readonly string[][], key: string): string | undefined {
  return tags.find((entry) => entry[0] === key)?.[1];
}

/** Decode a base64 (or base64url) encoded value into its UTF-8 string. */
function decodeBase64(encoded: string): string {
  const standard = encoded
    .replace(/-/gu, "+")
    .replace(/_/gu, "/")
    .padEnd(Math.ceil(encoded.length / 4) * 4, "=");
  return atob(standard);
}
