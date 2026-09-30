import { z } from "zod";

import { userPrincipalSchema } from "@chief/relay-contracts";

import { HttpError } from "./http";

/**
 * Signed, short-lived state for the browser legs of connecting GitHub. The
 * browser carries it to GitHub and back, so the relay can trust which
 * workspace and person a callback belongs to without a session.
 */
const ticketSchema = z.discriminatedUnion("purpose", [
  z.object({
    purpose: z.literal("setup"),
    principal: userPrincipalSchema,
    name: z.string(),
    expiresAt: z.number(),
  }),
  z.object({
    purpose: z.literal("install"),
    principal: userPrincipalSchema,
    expiresAt: z.number(),
  }),
]);

export type GitHubTicket = z.infer<typeof ticketSchema>;
type UnsignedTicket<Ticket> = Ticket extends GitHubTicket
  ? Omit<Ticket, "expiresAt">
  : never;

const TICKET_LIFETIME_MS = 30 * 60 * 1000;

export async function signGitHubTicket(
  secret: string,
  ticket: UnsignedTicket<GitHubTicket>,
  now = Date.now(),
) {
  const payload = encode(
    new TextEncoder().encode(
      JSON.stringify({ ...ticket, expiresAt: now + TICKET_LIFETIME_MS }),
    ),
  );
  return `${payload}.${encode(await hmac(secret, payload))}`;
}

export async function verifyGitHubTicket<
  Purpose extends GitHubTicket["purpose"],
>(secret: string, value: string | null, purpose: Purpose, now = Date.now()) {
  const [payload, signature] = (value ?? "").split(".");
  const expected = payload ? encode(await hmac(secret, payload)) : "";
  const parsed =
    payload && signature && timingSafeEqual(signature, expected)
      ? ticketSchema.safeParse(
          JSON.parse(new TextDecoder().decode(decode(payload))),
        )
      : undefined;
  if (
    !parsed?.success ||
    parsed.data.purpose !== purpose ||
    parsed.data.expiresAt < now
  ) {
    throw new HttpError(
      400,
      "github_link_expired",
      "This GitHub link has expired. Start again from Chief.",
    );
  }
  // The purpose was checked above, so the ticket is that purpose's variant.
  return parsed.data as Extract<GitHubTicket, { purpose: Purpose }>;
}

async function hmac(secret: string, payload: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(`chief-github-ticket:${secret}`),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)),
  );
}

function timingSafeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

function encode(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/=+$/u, "")
    .replace(/\+/gu, "-")
    .replace(/\//gu, "_");
}

function decode(value: string) {
  const base64 = value.replace(/-/gu, "+").replace(/_/gu, "/");
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
}
