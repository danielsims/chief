import { createRemoteJWKSet, jwtVerify } from "jose";

import type {
  ExecutionCapability,
  ExecutionLease,
} from "@chief/relay-contracts";
import { executionLeaseSchema } from "@chief/relay-contracts";

import type { ExecutorConfig } from "./config";

export class LeaseVerifier {
  private readonly jwks?: ReturnType<typeof createRemoteJWKSet>;
  private readonly sharedSecret?: Uint8Array;

  constructor(private readonly config: ExecutorConfig) {
    if (config.auth.kind === "jwks") {
      this.jwks = createRemoteJWKSet(new URL(config.auth.jwksUrl));
    } else {
      this.sharedSecret = new TextEncoder().encode(config.auth.secret);
    }
  }

  async verify(request: Request): Promise<ExecutionLease> {
    const header = request.headers.get("authorization");
    if (!header?.startsWith("Bearer "))
      throw new LeaseError("Lease token required.");
    try {
      const token = header.slice(7).trim();
      const options = {
        issuer: this.config.auth.issuer,
        audience: this.config.auth.audience,
        algorithms:
          this.config.auth.kind === "shared-secret" ? ["HS256"] : undefined,
      };
      const result = await this.verifyToken(token, options);
      const lease = executionLeaseSchema.parse(result.payload.lease);
      if (new Date(lease.expiresAt).getTime() <= Date.now()) {
        throw new LeaseError("Lease token has expired.");
      }
      return lease;
    } catch {
      throw new LeaseError("Lease token is invalid or expired.");
    }
  }

  private async verifyToken(
    token: string,
    options: {
      issuer: string;
      audience: string;
      algorithms: string[] | undefined;
    },
  ) {
    if (this.config.auth.kind === "shared-secret" && this.sharedSecret) {
      return await jwtVerify(token, this.sharedSecret, options);
    }
    if (this.config.auth.kind === "jwks" && this.jwks) {
      return await jwtVerify(token, this.jwks, options);
    }
    throw new LeaseError("Computer authentication is not configured.");
  }
}

export function requireCapability(
  lease: ExecutionLease,
  capability: ExecutionCapability,
) {
  if (!lease.capabilities.includes(capability)) {
    throw new CapabilityError(`Execution lease does not grant ${capability}.`);
  }
}

export class LeaseError extends Error {}
export class CapabilityError extends Error {}
