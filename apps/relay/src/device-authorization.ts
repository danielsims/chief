import { jwtVerify, SignJWT } from "jose";

import type { HexPubkey, UserId } from "@chief/relay-contracts";
import { hexPubkeySchema, userIdSchema } from "@chief/relay-contracts";

import { AuthenticationError } from "./auth";

export const deviceAuthorizationHeader = "x-chief-device-authorization";

const audience = "chief-relay-device";
const tokenLifetimeSeconds = 24 * 60 * 60;

export async function issueDeviceAuthorization(
  env: Env,
  input: { pubkey: HexPubkey; userId: UserId },
) {
  const issuedAt = Math.floor(Date.now() / 1_000);
  const expiresAt = issuedAt + tokenLifetimeSeconds;
  const token = await new SignJWT({ pubkey: input.pubkey })
    .setProtectedHeader({ alg: "HS256", typ: "chief-device+jwt" })
    .setIssuer(issuer(env))
    .setAudience(audience)
    .setSubject(input.userId)
    .setIssuedAt(issuedAt)
    .setExpirationTime(expiresAt)
    .sign(await signingKey(env));
  return {
    deviceAuthorization: token,
    expiresAt: new Date(expiresAt * 1_000).toISOString(),
  };
}

export async function verifyDeviceAuthorization(
  env: Env,
  token: string,
  expectedPubkey: HexPubkey,
) {
  try {
    const { payload, protectedHeader } = await jwtVerify(
      token,
      await signingKey(env),
      {
        issuer: issuer(env),
        audience,
        algorithms: ["HS256"],
      },
    );
    if (protectedHeader.typ !== "chief-device+jwt") {
      throw new Error("Unexpected device authorization type.");
    }
    const pubkey = hexPubkeySchema.parse(payload.pubkey);
    if (pubkey !== expectedPubkey) {
      throw new Error("Device authorization key mismatch.");
    }
    return {
      kind: "user" as const,
      userId: userIdSchema.parse(payload.sub),
      pubkey,
    };
  } catch {
    throw new AuthenticationError(
      "This device authorization is invalid or expired. Sign in again.",
    );
  }
}

async function signingKey(env: Env) {
  const material = new TextEncoder().encode(
    `chief-device-authorization-v1\0${env.BETTER_AUTH_SECRET}`,
  );
  return new Uint8Array(await crypto.subtle.digest("SHA-256", material));
}

function issuer(env: Env) {
  return env.AUTH_BASE_URL.replace(/\/$/u, "");
}
