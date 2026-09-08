import { jwtVerify, SignJWT } from "jose";

import type { HexPubkey, UserId } from "@chief/relay-contracts";
import { hexPubkeySchema, userIdSchema } from "@chief/relay-contracts";

import { AuthenticationError } from "./auth";

export const deviceAuthorizationHeader = "x-chief-device-authorization";

export interface DeviceAuthorizationEnvironment {
  AUTH_BASE_URL: string;
  BETTER_AUTH_SECRET: string;
}

const audience = "relay-device";
const tokenLifetimeSeconds = 24 * 60 * 60;

export async function issueDeviceAuthorization(
  env: DeviceAuthorizationEnvironment,
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
  env: DeviceAuthorizationEnvironment,
  token: string,
  expectedPubkey: HexPubkey,
) {
  try {
    if (!isCanonicalCompactJws(token)) {
      throw new Error("Device authorization is not canonically encoded.");
    }
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

function isCanonicalCompactJws(token: string) {
  const segments = token.split(".");
  return (
    segments.length === 3 &&
    segments.every((segment) => {
      if (!segment || !/^[A-Za-z0-9_-]+$/u.test(segment)) return false;
      try {
        const base64 = segment.replaceAll("-", "+").replaceAll("_", "/");
        const padding = "=".repeat((4 - (base64.length % 4)) % 4);
        const decoded = atob(base64 + padding);
        const canonical = btoa(decoded)
          .replaceAll("+", "-")
          .replaceAll("/", "_")
          .replace(/=+$/u, "");
        return canonical === segment;
      } catch {
        return false;
      }
    })
  );
}

async function signingKey(env: DeviceAuthorizationEnvironment) {
  const material = new TextEncoder().encode(
    `chief-device-authorization-v1\0${env.BETTER_AUTH_SECRET}`,
  );
  return new Uint8Array(await crypto.subtle.digest("SHA-256", material));
}

function issuer(env: DeviceAuthorizationEnvironment) {
  return env.AUTH_BASE_URL.replace(/\/$/u, "");
}
