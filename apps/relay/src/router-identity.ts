import {
  registerPushDeviceCommandSchema,
  unregisterPushDeviceCommandSchema,
} from "@chief/relay-contracts";

import { AuthorizationError } from "./auth";
import { bindDeviceIdentity } from "./device-identities";
import { authenticateRelayRequest, requireAccountBinding } from "./router-auth";
import { withTrustedAccountIdentity } from "./internal-context";
import { accountStub } from "./workspace-stubs";

export async function routeIdentityAndPush(env: Env, request: Request) {
  const url = new URL(request.url);
  if (url.pathname === "/v1/identity/device" && request.method === "POST") {
    return bindDeviceIdentity(env, request);
  }
  if (url.pathname !== "/v1/push/devices") return undefined;
  if (request.method !== "POST" && request.method !== "DELETE") return undefined;
  const authenticated = await authenticateRelayRequest(request, env);
  requireAccountBinding(env, authenticated.bound);
  if (authenticated.identity.kind !== "user") {
    throw new AuthorizationError("A user identity is required.");
  }
  const operation =
    request.method === "DELETE" ? "delete-push-device" : "register-push-device";
  const command =
    request.method === "DELETE"
      ? unregisterPushDeviceCommandSchema.parse(
          await authenticated.request.json(),
        )
      : registerPushDeviceCommandSchema.parse(await authenticated.request.json());
  return accountStub(env, authenticated.identity.userId).fetch(
    withTrustedAccountIdentity(authenticated.identity, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-chief-internal-operation": operation,
      },
      body: JSON.stringify(command),
    }),
  );
}
