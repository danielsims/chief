import type { AuthenticatedIdentity } from "@chief/relay-contracts";
import {
  bindDeviceIdentityCommandSchema,
  boundDeviceIdentitySchema,
  hexPubkeySchema,
  userIdSchema,
} from "@chief/relay-contracts";

import { verifyRelayAccountCredential } from "./auth/account-credential";
import {
  deviceAuthorizationHeader,
  issueDeviceAuthorization,
  verifyDeviceAuthorization,
} from "./device-authorization";
import { json } from "./http";
import { verifyNip98Auth } from "./nip98";

export async function bindDeviceIdentity(env: Env, request: Request) {
  const body = await request.text();
  const pubkey = hexPubkeySchema.parse(
    verifyNip98Auth(request.headers.get("authorization"), {
      url: request.url,
      method: request.method,
      body,
    }),
  );
  const input = bindDeviceIdentityCommandSchema.parse(JSON.parse(body));
  if (env.ACCOUNT_IDENTITY_MODE === "key-native") {
    const userId = userIdSchema.parse(pubkey);
    const authorization = await issueDeviceAuthorization(env, {
      pubkey,
      userId,
    });
    return json(
      boundDeviceIdentitySchema.parse({ userId, pubkey, ...authorization }),
    );
  }
  const { relayAuthUserId } = await verifyRelayAccountCredential(
    env,
    input.accountToken,
  );
  const userId = userIdSchema.parse(relayAuthUserId);
  const authorization = await issueDeviceAuthorization(env, {
    pubkey,
    userId,
  });
  return json(
    boundDeviceIdentitySchema.parse({ userId, pubkey, ...authorization }),
  );
}

export async function resolveDeviceIdentity(
  env: Env,
  identity: AuthenticatedIdentity,
  request: Request,
) {
  if (identity.kind !== "user" || env.ACCOUNT_IDENTITY_MODE === "key-native") {
    return { identity, bound: env.ACCOUNT_IDENTITY_MODE === "key-native" };
  }
  const token = requestDeviceAuthorization(request);
  if (!token) return { identity, bound: false };
  return {
    bound: true,
    identity: await verifyDeviceAuthorization(env, token, identity.pubkey),
  };
}

function requestDeviceAuthorization(request: Request) {
  const value = request.headers.get(deviceAuthorizationHeader)?.trim();
  return value === undefined || value === "" ? undefined : value;
}
