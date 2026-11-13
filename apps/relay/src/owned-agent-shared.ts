import type {
  ConversationEvent,
  ConversationMessage,
  Principal,
} from "@chief/relay-contracts";
import { OWNED_AGENT_USER_CODE_ALPHABET } from "@chief/relay-contracts";

import type { ChannelRow } from "./workspace-channel-store";
import { HttpError } from "./http";

export const OWNED_AGENT_GATEWAY_SERVICE = "owned-agent-gateway";
export const OWNED_AGENT_ID_HEADER = "x-chief-owned-agent-id";
export const OWNED_AGENT_PUBKEY_HEADER = "x-chief-owned-agent-pubkey";
export const OWNED_AGENT_ORIGIN_HEADER = "x-chief-public-origin";

export const CONNECT_CODE_LIFETIME_MS = 15 * 60_000;
export const DEVICE_CODE_LIFETIME_SECONDS = 600;
export const DEVICE_CODE_POLL_INTERVAL_SECONDS = 5;
export const challengeLifetimeMs = 60_000;
export const maximumActiveCodesPerMember = 5;
export const maximumRequestsPerCode = 5;
export const maximumPendingRequestsPerMember = 5;
export const maximumAgentsPerMember = 20;
export const postWindowMs = 10 * 60_000;
export const maximumPostsPerWindow = 30;
export const lookaheadEvents = 500;
/** Polling a little early is clock skew, not a client ignoring the interval. */
export const pollToleranceMs = 500;

export interface LiveEventRow extends Record<string, SqlStorageValue> {
  sequence: number;
  event_json: string;
}

export type MemberPrincipal = Extract<Principal, { kind: "user" }>;

/** Channel removal also removes the agents that were in it. */

export function channelSummary(channel: ChannelRow) {
  return { id: channel.conversation_id, name: channel.name };
}

/**
 * Reduces an event stream to the current state of each appended message.
 * Later edits replace the text; deleted and empty messages are dropped.
 */
export function foldMessages(events: readonly ConversationEvent[]) {
  const messages = new Map<
    string,
    { message: ConversationMessage; cursor: number }
  >();
  for (const event of events) {
    const message = event.payload.message;
    const known = messages.get(message.id);
    if (event.type === "conversation.message.appended") {
      messages.set(message.id, { message, cursor: event.sequence });
    } else if (known) {
      messages.set(message.id, { message, cursor: known.cursor });
    }
  }
  return [...messages.values()].filter(
    ({ message }) => !message.deleted && message.body.trim() !== "",
  );
}

export function tokenError(code: string, message: string, interval?: number) {
  return new HttpError(
    400,
    code,
    message,
    interval === undefined ? undefined : { interval },
  );
}

/** Eight letters from the unambiguous alphabet, drawn without modulo bias. */
export function randomUserCode() {
  const alphabet = OWNED_AGENT_USER_CODE_ALPHABET;
  const limit = 256 - (256 % alphabet.length);
  let letters = "";
  while (letters.length < 8) {
    for (const byte of crypto.getRandomValues(new Uint8Array(16))) {
      if (byte >= limit || letters.length === 8) continue;
      letters += alphabet.charAt(byte % alphabet.length);
    }
  }
  return `${letters.slice(0, 4)}-${letters.slice(4)}`;
}

export function base64Url(value: string) {
  let binary = "";
  for (const byte of new TextEncoder().encode(value)) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replace(/\+/gu, "-")
    .replace(/\//gu, "_")
    .replace(/=+$/gu, "");
}

export function clampInteger(
  value: string | null,
  fallback: number,
  minimum: number,
  maximum = Number.MAX_SAFE_INTEGER,
) {
  const parsed = value === null ? Number.NaN : Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, minimum), maximum);
}
