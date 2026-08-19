import { createRemoteJWKSet, jwtVerify } from "jose";

import type { AuthenticatedIdentity } from "@chief/relay-contracts";
import {
  authenticatedIdentitySchema,
  userIdSchema,
} from "@chief/relay-contracts";

interface TokenClaims {
  identity?: unknown;
}

export class RelayAuthenticator {
  private readonly jwks: ReturnType<typeof createRemoteJWKSet>;

  constructor(private readonly env: Env) {
    this.jwks = createRemoteJWKSet(new URL(env.AUTH_JWKS_URL));
  }

  async authenticate(request: Request): Promise<AuthenticatedIdentity> {
    const authorization = request.headers.get("authorization");
    if (!authorization?.startsWith("Bearer ")) {
      throw new AuthenticationError("A bearer token is required.");
    }

    const token = authorization.slice("Bearer ".length).trim();
    try {
      const result = await jwtVerify<TokenClaims>(token, this.jwks, {
        issuer: this.env.AUTH_ISSUER,
        audience: this.env.AUTH_AUDIENCE,
      });
      if (result.payload.identity !== undefined) {
        return authenticatedIdentitySchema.parse(result.payload.identity);
      }
      return authenticatedIdentitySchema.parse({
        kind: "user",
        userId: userIdSchema.parse(result.payload.sub),
      });
    } catch {
      throw new AuthenticationError("The bearer token is not valid.");
    }
  }
}

export class AuthenticationError extends Error {}
export class AuthorizationError extends Error {}
