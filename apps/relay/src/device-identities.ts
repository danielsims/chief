import type { AuthenticatedIdentity } from "@chief/relay-contracts";
import {
  bindDeviceIdentityCommandSchema,
  boundDeviceIdentitySchema,
  hexPubkeySchema,
  userIdSchema,
} from "@chief/relay-contracts";

import { verifyAccountToken } from "./account-token";
import { json, relayError } from "./http";
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
  const { accountSubject } = await verifyAccountToken(env, input.accountToken);
  const account = env.IDENTITIES.get(
    env.IDENTITIES.idFromName(`account:${accountSubject}`),
  );
  const accountResponse = await identityRpc(
    account,
    "account-resolve-or-create",
    {
      accountSubject,
      candidateUserId: pubkey,
    },
  );
  if (!accountResponse.ok) return accountResponse;
  const accountPayload: unknown = await accountResponse.json();
  if (
    typeof accountPayload !== "object" ||
    accountPayload === null ||
    !("userId" in accountPayload)
  ) {
    throw new Error("The account identity response is invalid.");
  }
  const accountBinding = userIdSchema.parse(accountPayload.userId);
  const device = env.IDENTITIES.get(
    env.IDENTITIES.idFromName(`device:${pubkey}`),
  );
  const response = await identityRpc(device, "device-bind", {
    accountSubject,
    userId: accountBinding,
    pubkey,
  });
  if (!response.ok) return response;
  return json(boundDeviceIdentitySchema.parse(await response.json()), {
    status: response.status,
  });
}

export async function resolveDeviceIdentity(
  env: Env,
  identity: AuthenticatedIdentity,
) {
  if (identity.kind !== "user" || env.ACCOUNT_IDENTITY_MODE === "key-native") {
    return { identity, bound: env.ACCOUNT_IDENTITY_MODE === "key-native" };
  }
  const device = env.IDENTITIES.get(
    env.IDENTITIES.idFromName(`device:${identity.pubkey}`),
  );
  const response = await identityRpc(device, "device-resolve");
  if (response.status === 204) return { identity, bound: false };
  if (!response.ok) {
    return {
      response: relayError(
        401,
        "device_identity_denied",
        "Device identity denied.",
      ),
    };
  }
  const binding = boundDeviceIdentitySchema.parse(await response.json());
  return {
    bound: true,
    identity: {
      kind: "user" as const,
      userId: binding.userId,
      pubkey: binding.pubkey,
    },
  };
}

function identityRpc(
  stub: DurableObjectStub,
  operation: string,
  body?: Record<string, unknown>,
) {
  return stub.fetch(
    new Request("https://identity.internal", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-chief-internal-operation": operation,
      },
      body: body ? JSON.stringify(body) : undefined,
    }),
  );
}
