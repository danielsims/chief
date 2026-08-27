import { env } from "cloudflare:workers";

import { hexPubkeySchema } from "@chief/relay-contracts";

export function relayTestEnv(): Env {
  return {
    ...env,
    BETTER_AUTH_SECRET: "test-auth-secret",
    BOOTSTRAP_TOKEN_SHA256: "test-bootstrap-token",
    CLOUDFLARE_ACCOUNT_ID: "test-account",
    CLOUDFLARE_EMAIL_API_TOKEN: "test-email-token",
    EMAIL_FROM_ADDRESS: "test@example.test",
    EMAIL_FROM_NAME: "Chief Test",
    RELAY_SECRET_KEY: "test-relay-secret-master-key-0123456789abcdef",
    RELAY_ID: "relay_test",
  };
}

/** Deterministic 32-byte hex pubkey for tests. */
export function hexKey(seed: string): string {
  let out = "";
  for (let round = 0; round < 8; round += 1) {
    let h = (2166136261 ^ round) >>> 0;
    for (const char of seed) {
      h ^= char.charCodeAt(0);
      h = Math.imul(h, 16777619) >>> 0;
    }
    out += h.toString(16).padStart(8, "0");
  }
  return hexPubkeySchema.parse(out);
}

/** User identity with a pubkey derived from a seed. */
export function testUserIdentity(seed: string) {
  return {
    kind: "user" as const,
    userId: seed,
    pubkey: hexKey(seed),
  };
}
