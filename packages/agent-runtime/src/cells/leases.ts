import type { CellPersistence } from "./sqlite-store.js";
import type { RunLeaseState } from "./types.js";

export interface AcquireRunInput {
  runId: string;
  agentId: string;
  ttlMs?: number;
}

const DEFAULT_RUN_TTL_MS = 60_000;

/**
 * Renewable run leases. Losing a lease moves a run into recoverable state so
 * it resumes from durable tool and outbox boundaries instead of arbitrary
 * in-memory reasoning.
 */
export class RunLeaseManager {
  constructor(private readonly persistence: CellPersistence) {}

  async acquire(
    cellId: string,
    input: AcquireRunInput,
  ): Promise<RunLeaseState> {
    const expiresAt = Date.now() + (input.ttlMs ?? DEFAULT_RUN_TTL_MS);
    const lease: RunLeaseState = {
      runId: input.runId,
      agentId: input.agentId,
      expiresAt,
    };
    const acquired = await this.persistence.acquireLease(cellId, lease);
    if (!acquired) {
      throw new Error("Another run holds the lease for this cell.");
    }
    return lease;
  }

  async renew(cellId: string, runId: string, ttlMs = DEFAULT_RUN_TTL_MS) {
    const current = await this.persistence.lease(cellId);
    if (current?.runId !== runId) {
      throw new Error("The run lost its lease and must recover.");
    }
    const expiresAt = Date.now() + ttlMs;
    const renewed = await this.persistence.acquireLease(cellId, {
      ...current,
      expiresAt,
    });
    if (!renewed) {
      throw new Error("The run lost its lease and must recover.");
    }
    return expiresAt;
  }

  async release(cellId: string, runId: string) {
    await this.persistence.releaseLease(cellId, runId);
  }

  async current(cellId: string): Promise<RunLeaseState | undefined> {
    const lease = await this.persistence.lease(cellId);
    if (!lease || lease.expiresAt <= Date.now()) return undefined;
    return lease;
  }

  async expireStale(now = Date.now()) {
    return this.persistence.expireLeases(now);
  }
}
