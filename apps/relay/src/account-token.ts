import type { JWTVerifyGetKey } from "jose";
import { createRemoteJWKSet, jwtVerify } from "jose";

import { AuthenticationError } from "./auth";

const keySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

/** Verifies the short-lived Better Auth/Convex account token at the central
 * issuer. The token is used only to bind a device key and never replaces
 * NIP-98 on relay requests. */
export async function verifyAccountToken(env: Env, token: string) {
  return verifyAccountTokenWithKeySet(
    token,
    remoteKeySet(env.AUTH_JWKS_URL),
    env.AUTH_ISSUER,
  );
}

export async function verifyAccountTokenWithKeySet(
  token: string,
  keySet: JWTVerifyGetKey,
  issuer: string,
) {
  try {
    const { payload } = await jwtVerify(token, keySet, {
      issuer,
      audience: "convex",
      algorithms: ["RS256"],
    });
    if (typeof payload.sub !== "string" || !payload.sub.trim()) {
      throw new AuthenticationError("The account token has no subject.");
    }
    return { accountSubject: payload.sub };
  } catch (error) {
    if (error instanceof AuthenticationError) throw error;
    // Keep diagnostics claim-level only. Never log the bearer token, payload,
    // subject, or raw JOSE error message.
    console.warn(
      "Account token verification failed",
      joseFailureMetadata(error),
    );
    throw new AuthenticationError("The account token is invalid or expired.");
  }
}

function joseFailureMetadata(error: unknown) {
  if (typeof error !== "object" || error === null) return { code: "unknown" };
  return {
    code: stringProperty(error, "code"),
    claim: stringProperty(error, "claim"),
    reason: stringProperty(error, "reason"),
  };
}

function stringProperty(value: object, property: string) {
  if (!(property in value)) return undefined;
  const candidate: unknown = Reflect.get(value, property);
  return typeof candidate === "string" ? candidate : undefined;
}

function remoteKeySet(url: string) {
  let keySet = keySets.get(url);
  if (!keySet) {
    keySet = createRemoteJWKSet(new URL(url), {
      cooldownDuration: 30_000,
      cacheMaxAge: 10 * 60_000,
      timeoutDuration: 5_000,
    });
    keySets.set(url, keySet);
  }
  return keySet;
}
