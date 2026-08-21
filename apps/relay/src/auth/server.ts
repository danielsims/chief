import { relayAuthOptions } from "./config";

export async function createRelayAuth(env: Env) {
  const { createChiefD1Auth } = await import("@chief/auth/d1");
  return createChiefD1Auth(env.AUTH_DB, relayAuthOptions(env));
}
