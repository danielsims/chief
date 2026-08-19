import { createRemoteJWKSet, jwtVerify } from "jose";

import type {
  ExecutionCapability,
  ExecutionLease,
} from "@chief/relay-contracts";
import { executionLeaseSchema } from "@chief/relay-contracts";

import type { ExecutorConfig } from "./config";

export class LeaseVerifier {
  private readonly jwks: ReturnType<typeof createRemoteJWKSet>;

  constructor(private readonly config: ExecutorConfig) {
    this.jwks = createRemoteJWKSet(new URL(config.EXECUTOR_AUTH_JWKS_URL));
  }

  async verify(request: Request): Promise<ExecutionLease> {
    const header = request.headers.get("authorization");
    if (!header?.startsWith("Bearer "))
      throw new LeaseError("Lease token required.");
    try {
      const result = await jwtVerify(header.slice(7).trim(), this.jwks, {
        issuer: this.config.EXECUTOR_AUTH_ISSUER,
        audience: this.config.EXECUTOR_AUTH_AUDIENCE,
      });
      return executionLeaseSchema.parse(result.payload.lease);
    } catch {
      throw new LeaseError("Lease token is invalid or expired.");
    }
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
