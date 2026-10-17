import { z } from "zod";

import { agentIdSchema, workspaceIdSchema } from "@chief/relay-contracts";

import { HttpError } from "./http";

/**
 * A signed, short-lived, read-only credential for cloning a workspace Git
 * repository. It is carried as a bearer token by the Git client, which cannot
 * produce the NIP-98 signatures the public relay routes use.
 *
 * The token is scoped to exactly one workspace and one repository, grants only
 * read (clone/fetch), and expires quickly. It is signed with a purpose-prefixed
 * HMAC key so a token from another subsystem can never be replayed here, and
 * never persisted or logged.
 */
const tokenSchema = z.object({
  workspaceId: workspaceIdSchema,
  repo: z.string().trim().min(1).max(128),
  agentId: agentIdSchema,
  scope: z.literal("read"),
  expiresAt: z.number(),
});

export type WorkspaceGitToken = z.infer<typeof tokenSchema>;

const TOKEN_LIFETIME_MS = 10 * 60 * 1000;

export async function signWorkspaceGitToken(
  secret: string,
  input: { workspaceId: string; repo: string; agentId: string },
  now = Date.now(),
): Promise<{ token: string; expiresAt: number }> {
  const expiresAt = now + TOKEN_LIFETIME_MS;
  const payload = encode(
    new TextEncoder().encode(
      JSON.stringify({
        workspaceId: input.workspaceId,
        repo: input.repo,
        agentId: input.agentId,
        scope: "read",
        expiresAt,
      }),
    ),
  );
  return {
    token: `${payload}.${encode(await hmac(secret, payload))}`,
    expiresAt,
  };
}

export async function verifyWorkspaceGitToken(
  secret: string,
  value: string | null,
  now = Date.now(),
): Promise<WorkspaceGitToken> {
  const [payload, signature] = (value ?? "").split(".");
  const expected = payload ? encode(await hmac(secret, payload)) : "";
  const parsed =
    payload && signature && timingSafeEqual(signature, expected)
      ? tokenSchema.safeParse(
          JSON.parse(new TextDecoder().decode(decode(payload))),
        )
      : undefined;
  if (!parsed?.success || parsed.data.expiresAt < now) {
    throw new HttpError(
      401,
      "git_token_invalid",
      "This repository credential is invalid or expired.",
    );
  }
  return parsed.data;
}

async function hmac(secret: string, payload: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(`workspace-git-token:${secret}`),
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
