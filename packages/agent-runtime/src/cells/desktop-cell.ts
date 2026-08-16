import { randomUUID } from "node:crypto";

import type { CellPersistence } from "./sqlite-store.js";
import type {
  AgentAlarm,
  AgentCell,
  AgentCellState,
  AgentCellStatus,
  AgentEvent,
  EnqueueResult,
  ProjectLease,
  ProjectLeaseRequest,
} from "./types.js";
import { RunLeaseManager } from "./leases.js";

const DEFAULT_PROJECT_LEASE_TTL_MS = 15 * 60_000;

/**
 * The desktop cell adapter. It persists events, cursors, leases, and outbox
 * state across app restarts through the local runtime database, so a restart
 * resumes deterministically from committed tool and outbox boundaries.
 */
export class DesktopAgentCell implements AgentCell {
  private readonly leases: RunLeaseManager;

  constructor(
    readonly id: string,
    private readonly persistence: CellPersistence,
  ) {
    this.leases = new RunLeaseManager(persistence);
  }

  async enqueue(event: AgentEvent): Promise<EnqueueResult> {
    const outcome = await this.persistence.enqueue(this.id, event);
    return {
      accepted: !outcome.duplicate,
      duplicate: outcome.duplicate,
      position: outcome.position,
    };
  }

  async getStatus(): Promise<AgentCellStatus> {
    const [lease, lastEvent] = await Promise.all([
      this.leases.current(this.id),
      this.persistence.lastEvent(this.id),
    ]);
    const lastProgressAt = (await this.persistence.readState(
      this.id,
      "lastProgressAt",
    )) as number | undefined;
    let state: AgentCellState = "idle";
    if (lease) state = "running";
    else if (lastEvent) state = "idle";
    return {
      state,
      ...(lastEvent ? { lastEventId: lastEvent.id } : {}),
      ...(lastEvent ? { lastEventPosition: lastEvent.position } : {}),
      ...(lastProgressAt ? { lastProgressAt } : {}),
      ...(lease ? { lease } : {}),
    };
  }

  async readState<T>(key: string): Promise<T | undefined> {
    return (await this.persistence.readState(this.id, key)) as T | undefined;
  }

  async writeState<T>(key: string, value: T): Promise<void> {
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
      expiresAt: Date.now() + (input.ttlMs ?? DEFAULT_PROJECT_LEASE_TTL_MS),
    };
    await this.persistence.saveProjectLease(this.id, lease);
    return lease;
  }

  async releaseProject(leaseId: string): Promise<void> {
    await this.persistence.releaseProjectLease(this.id, leaseId);
  }

  /** Access to the lease manager, used by the run harness. */
  get leasesManager(): RunLeaseManager {
    return this.leases;
  }
}
