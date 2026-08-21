import type { AuthenticatedIdentity } from "@chief/relay-contracts";

import { AuthenticationError, RelayAuthenticator } from "./auth";
import { resolveDeviceIdentity } from "./device-identities";
import { enforceIdentityRequestLimits } from "./request-rate-limits";

/** Buffers mutable request bodies so the NIP-98 payload tag is verified
 * against the exact body later forwarded to an internal authority object. */
export async function authenticateRelayRequest(
  request: Request,
  env: Env,
): Promise<{
  identity: AuthenticatedIdentity;
  request: Request;
  bound: boolean;
}> {
  let body: string | null | undefined;
  if (request.method !== "GET" && request.method !== "HEAD") {
    body = await request.text();
  }
  const signedIdentity = new RelayAuthenticator().authenticate(request, body);
  await enforceIdentityRequestLimits(env, request, signedIdentity.pubkey);
  const resolved = await resolveDeviceIdentity(env, signedIdentity, request);
  if (body === undefined) {
    return {
      identity: resolved.identity,
      request,
      bound: resolved.bound,
    };
  }
  return {
    identity: resolved.identity,
    bound: resolved.bound,
    request: new Request(request.url, {
      method: request.method,
      headers: request.headers,
      body,
    }),
  };
}

export function requireAccountBinding(env: Env, bound: boolean) {
  if (env.ACCOUNT_IDENTITY_MODE === "chief-account" && !bound) {
    throw new AuthenticationError(
      "Bind this device key to the signed-in Chief account first.",
    );
  }
}
