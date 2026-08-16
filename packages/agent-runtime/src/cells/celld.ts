import { randomUUID } from "node:crypto";

import type { CellPersistence } from "./sqlite-store.js";
import type {
  AgentAlarm,
  AgentCell,
  AgentCellStatus,
  AgentEvent,
  EnqueueResult,
  ProjectLease,
  ProjectLeaseRequest,
} from "./types.js";
import { RunLeaseManager } from "./leases.js";

const DEFAULT_PROJECT_LEASE_TTL_MS = 15 * 60_000;

/** Platform limits the cellD proof of concept enforces (documented in the PRD). */
export const CELD_DOCUMENTED_LIMITS = {
  maxStateBytes: 8 * 1024 * 1024,
  maxEvents: 10_000,
  backgroundTimeoutMs: 30_000,
} as const;

/**
 * EXPERIMENTAL cellD-compatible adapter. It implements the same cell contract
 * over the same storage so the conformance suite runs unchanged, and enforces
 * the documented platform limits. It must NOT be treated as production-ready:
 * on-device encryption, background execution guarantees, upgrade behavior,
 * and tenant isolation still require the PRD's security review before any
 * hosted or on-device rollout.
 */
export class CellDCell implements AgentCell {
  private readonly leases: RunLeaseManager;

  constructor(
    readonly id: string,
    private readonly persistence: CellPersistence,
    private readonly now: () => number = Date.now,
  ) {
    this.leases = new RunLeaseManager(persistence);
  }

  async enqueue(event: AgentEvent): Promise<EnqueueResult> {
    const count = await this.persistence.events(this.id);
    if (count.length >= CELD_DOCUMENTED_LIMITS.maxEvents) {
      return { accepted: false, duplicate: false, position: count.length };
    }
    const outcome = await this.persistence.enqueue(this.id, event);
    return {
      accepted: !outcome.duplicate,
      duplicate: outcome.duplicate,
      position: outcome.position,
    };
  }

  async getStatus(): Promise<AgentCellStatus> {
    const [lease, lastEvent, progressBytes] = await Promise.all([
      this.leases.current(this.id),
      this.persistence.lastEvent(this.id),
      this.stateBytes(),
    ]);
    const overLimit = progressBytes > CELD_DOCUMENTED_LIMITS.maxStateBytes;
    return {
      state: overLimit ? "failed" : lease ? "running" : "idle",
      ...(lastEvent ? { lastEventId: lastEvent.id } : {}),
      ...(lastEvent ? { lastEventPosition: lastEvent.position } : {}),
      ...(lease ? { lease } : {}),
    };
  }

  async readState<T>(key: string): Promise<T | undefined> {
    return (await this.persistence.readState(this.id, key)) as T | undefined;
  }

  async writeState<T>(key: string, value: T): Promise<void> {
    const bytes = approximateBytes(value);
    if (
      (await this.stateBytes()) + bytes >
      CELD_DOCUMENTED_LIMITS.maxStateBytes
    ) {
      throw new Error("cellD state budget exceeded.");
    }
    await this.persistence.writeState(this.id, key, value);
  }

  async schedule(input: AgentAlarm): Promise<void> {
    await this.persistence.saveAlarm(this.id, input);
  }

  async cancelAlarm(id: string): Promise<void> {
    await this.persistence.deleteAlarm(this.id, id);
  }

  async acquireProject(input: ProjectLeaseRequest): Promise<ProjectLease> {
    const lease: ProjectLease = {
      leaseId: randomUUID(),
      projectId: input.projectId,
      agentId: input.agentId,
      ...(input.baseRef ? { branch: input.baseRef } : {}),
      expiresAt: this.now() + (input.ttlMs ?? DEFAULT_PROJECT_LEASE_TTL_MS),
    };
    await this.persistence.saveProjectLease(this.id, lease);
    return lease;
  }

  async releaseProject(leaseId: string): Promise<void> {
    await this.persistence.releaseProjectLease(this.id, leaseId);
  }

  get leasesManager(): RunLeaseManager {
    return this.leases;
  }

  private async stateBytes() {
    const pending = await this.persistence.listOutbox(this.id);
    return pending.length * 256;
  }
}

function approximateBytes(value: unknown) {
  const serialized = JSON.stringify(value);
  return serialized ? serialized.length : 0;
}
