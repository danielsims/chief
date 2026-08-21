import type { AuthenticatedIdentity } from "@chief/relay-contracts";
import { hexPubkeySchema, userIdSchema } from "@chief/relay-contracts";

import { sha256PayloadTag, verifyNip98Auth } from "./nip98";

/**
 * Authenticates relay requests with NIP-98 nostr HTTP auth. There is no issuer,
 * JWKS, or external identity provider: the secp256k1 Schnorr signature over a
 * kind-27235 event proves possession of the private key whose public key is the
 * caller's identity. Convex is not part of the runtime path.
 */
export class RelayAuthenticator {
  authenticate(
    request: Request,
    body?: string | null,
  ): Extract<AuthenticatedIdentity, { kind: "user" }> {
    const pubkey = verifyNip98Auth(request.headers.get("authorization"), {
      url: request.url,
      method: request.method,
      body,
    });
    return {
      kind: "user",
      userId: userIdSchema.parse(pubkey),
      pubkey: hexPubkeySchema.parse(pubkey),
    };
  }
}

export { sha256PayloadTag };
export class AuthenticationError extends Error {}
export class AuthorizationError extends Error {}
