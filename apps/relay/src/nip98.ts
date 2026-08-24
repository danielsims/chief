import { schnorr } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";

import {
  isJsonNumber,
  isJsonObject,
  isJsonString,
} from "@chief/relay-contracts";

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
const NIP98_MAX_AUTHORIZATION_LENGTH = 16_384;

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
  if (authorization.length > NIP98_MAX_AUTHORIZATION_LENGTH) {
    throw new AuthenticationError(
      "The Nostr Authorization header is too large.",
    );
  }
  const scheme = authorization.slice(0, 5).toLowerCase();
  if (scheme !== "nostr") {
    throw new AuthenticationError("The Authorization scheme must be Nostr.");
  }
  const encoded = authorization.slice(5).trim();
  let event: Nip98Event;
  try {
    event = parseNip98Event(JSON.parse(decodeBase64(encoded)));
  } catch {
    throw new AuthenticationError("The Nostr event is not valid base64 JSON.");
  }

  const now = options.now ?? Math.floor(Date.now() / 1000);

  if (event.kind !== NIP98_EVENT_KIND) {
    throw new AuthenticationError(
      `The Nostr event kind must be ${NIP98_EVENT_KIND}.`,
    );
  }
  if (event.content !== "") {
    throw new AuthenticationError(
      "The Nostr HTTP auth event content must be empty.",
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
  if (
    options.body !== undefined &&
    options.body !== null &&
    options.body.length > 0 &&
    !payloadTag
  ) {
    throw new AuthenticationError(
      "A Nostr payload tag is required for requests with a body.",
    );
  }
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

  const expectedId = computeNostrEventId(event);
  if (event.id !== expectedId) {
    throw new AuthenticationError(
      "The Nostr event id does not match its signed fields.",
    );
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

/**
 * Computes the NIP-01 event id. Nostr signs the SHA-256 of the canonical
 * six-element event array, not the JSON event object sent over the wire.
 */
export function computeNostrEventId(
  event: Pick<
    Nip98Event,
    "pubkey" | "created_at" | "kind" | "tags" | "content"
  >,
): string {
  const serialized = JSON.stringify([
    0,
    event.pubkey,
    event.created_at,
    event.kind,
    event.tags,
    event.content,
  ]);
  return bytesToHex(sha256(new TextEncoder().encode(serialized)));
}

/** SHA-256 payload tag for POST bodies (hex). */
export function sha256PayloadTag(body: string | null | undefined): string {
  const source = body ?? "";
  return bytesToHex(sha256(new TextEncoder().encode(source)));
}

function tag(tags: readonly string[][], key: string): string | undefined {
  const matches = tags.filter((entry) => entry[0] === key);
  if (matches.length > 1) {
    throw new AuthenticationError(`The Nostr event has duplicate ${key} tags.`);
  }
  return matches[0]?.[1];
}

function parseNip98Event(value: unknown): Nip98Event {
  if (!value || !isJsonObject(value) || Array.isArray(value)) {
    throw new AuthenticationError("The Nostr event must be an object.");
  }
  const event = value as Record<string, unknown>;
  if (
    !isJsonString(event.id) ||
    !isJsonString(event.pubkey) ||
    !isJsonString(event.content) ||
    !isJsonNumber(event.kind) ||
    !isJsonNumber(event.created_at) ||
    !isJsonString(event.sig) ||
    !Array.isArray(event.tags) ||
    !event.tags.every(
      (entry) =>
        Array.isArray(entry) &&
        entry.length > 0 &&
        entry.length <= 4 &&
        entry.every((part) => isJsonString(part) && part.length <= 8_192),
    ) ||
    event.tags.length > 32
  ) {
    throw new AuthenticationError("The Nostr event shape is invalid.");
  }
  return event as unknown as Nip98Event;
}

/** Decode a base64 (or base64url) encoded value into its UTF-8 string. */
function decodeBase64(encoded: string): string {
  const standard = encoded
    .replace(/-/gu, "+")
    .replace(/_/gu, "/")
    .padEnd(Math.ceil(encoded.length / 4) * 4, "=");
  return atob(standard);
}
