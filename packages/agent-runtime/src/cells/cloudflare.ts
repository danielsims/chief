import { randomUUID } from "node:crypto";

import type { CellPersistence, EnqueueOutcome } from "./sqlite-store.js";
import type {
  AgentAlarm,
  AgentCell,
  AgentCellStatus,
  AgentEvent,
  CellStateValue,
  EnqueueResult,
  OutboxRecord,
  OutboxRecordState,
  ProjectLease,
  ProjectLeaseRequest,
  RunLeaseState,
} from "./types.js";

const DEFAULT_PROJECT_LEASE_TTL_MS = 15 * 60_000;

/**
 * The minimal key-value surface a hosted storage must satisfy. Cloudflare
 * Durable Object storage implements it in production; the memory store
 * implements it during local conformance runs. Full repository contents never
 * live here — only small durable coordination state.
 */
type CellKVRecord =
  | { kind: "events"; value: AgentEvent[] }
  | { kind: "state"; value: Record<string, CellStateValue> }
  | { kind: "alarms"; value: AgentAlarm[] }
  | { kind: "lease"; value: RunLeaseState }
  | { kind: "projectLeases"; value: ProjectLease[] }
  | { kind: "outbox"; value: OutboxRecord[] };

export interface CellKVStore {
  get(key: string): Promise<CellKVRecord | undefined>;
  put(key: string, record: CellKVRecord): Promise<void>;
  delete(key: string): Promise<void>;
  list(): Promise<{ key: string; value: CellKVRecord }[]>;
}

function keysOf(cellId: string) {
  return {
    events: `${cellId}\0events`,
    state: `${cellId}\0state`,
    alarms: `${cellId}\0alarms`,
    lease: `${cellId}\0lease`,
    projectLeases: `${cellId}\0projectLeases`,
    outbox: `${cellId}\0outbox`,
  };
}

/** A CellPersistence that stores small coordination state through a CellKVStore. */
export class CellStoragePersistence implements CellPersistence {
  constructor(private readonly storage: CellKVStore) {}

  private async storedEvents(cellId: string) {
    const record = await this.storage.get(keysOf(cellId).events);
    return record?.kind === "events" ? record.value : [];
  }

  private async storedState(cellId: string) {
    const record = await this.storage.get(keysOf(cellId).state);
    return record?.kind === "state" ? record.value : {};
  }

  private async storedAlarms(cellId: string) {
    const record = await this.storage.get(keysOf(cellId).alarms);
    return record?.kind === "alarms" ? record.value : [];
  }

  private async storedProjectLeases(cellId: string) {
    const record = await this.storage.get(keysOf(cellId).projectLeases);
    return record?.kind === "projectLeases" ? record.value : [];
  }

  private async storedOutbox(cellId: string) {
    const record = await this.storage.get(keysOf(cellId).outbox);
    return record?.kind === "outbox" ? record.value : [];
  }

  async enqueue(cellId: string, event: AgentEvent): Promise<EnqueueOutcome> {
    const events = await this.storedEvents(cellId);
    const existing = events.find(
      (candidate) => candidate.idempotencyKey === event.idempotencyKey,
    );
    if (existing) {
      return { duplicate: true, position: events.indexOf(existing) + 1 };
    }
    events.push(event);
    await this.storage.put(keysOf(cellId).events, {
      kind: "events",
      value: events,
    });
    return { duplicate: false, position: events.length };
  }

  async lastEvent(cellId: string) {
    const events = await this.storedEvents(cellId);
    const last = events.at(-1);
    return last ? { id: last.id, position: events.length } : undefined;
  }

  async events(cellId: string, afterPosition?: number) {
    const events = await this.storedEvents(cellId);
    return afterPosition ? events.slice(afterPosition) : [...events];
  }

  async readState(cellId: string, key: string) {
    const state = await this.storedState(cellId);
    return state[key];
  }

  async writeState(cellId: string, key: string, value: CellStateValue) {
    const state = await this.storedState(cellId);
    state[key] = value;
    await this.storage.put(keysOf(cellId).state, {
      kind: "state",
      value: state,
    });
  }

  async listDueAlarms(cellId: string, now: number) {
    const alarms = await this.storedAlarms(cellId);
    return alarms.filter((alarm) => alarm.at <= now);
  }

  async saveAlarm(cellId: string, alarm: AgentAlarm) {
    const alarms = await this.storedAlarms(cellId);
    const index = alarms.findIndex((candidate) => candidate.id === alarm.id);
    if (index >= 0) alarms[index] = alarm;
    else alarms.push(alarm);
    await this.storage.put(keysOf(cellId).alarms, {
      kind: "alarms",
      value: alarms,
    });
  }

  async deleteAlarm(cellId: string, alarmId: string) {
    const alarms = await this.storedAlarms(cellId);
    await this.storage.put(keysOf(cellId).alarms, {
      kind: "alarms",
      value: alarms.filter((alarm) => alarm.id !== alarmId),
    });
  }

  async acquireLease(cellId: string, lease: RunLeaseState) {
    const record = await this.storage.get(keysOf(cellId).lease);
    const current = record?.kind === "lease" ? record.value : undefined;
    if (
      current &&
      current.expiresAt > Date.now() &&
      current.runId !== lease.runId
    ) {
      return false;
    }
    await this.storage.put(keysOf(cellId).lease, {
      kind: "lease",
      value: lease,
    });
    return true;
  }

  async lease(cellId: string) {
    const record = await this.storage.get(keysOf(cellId).lease);
    return record?.kind === "lease" ? record.value : undefined;
  }

  async releaseLease(cellId: string, runId: string) {
    const current = await this.lease(cellId);
    if (current?.runId === runId) {
      await this.storage.delete(keysOf(cellId).lease);
    }
  }

  async expireLeases(now: number) {
    let removed = 0;
    for (const item of await this.storage.list()) {
      if (item.value.kind === "lease" && item.value.value.expiresAt <= now) {
        await this.storage.delete(item.key);
        removed += 1;
      }
    }
    return removed;
  }

  async saveProjectLease(cellId: string, lease: ProjectLease) {
    const leases = await this.storedProjectLeases(cellId);
    leases.push(lease);
    await this.storage.put(keysOf(cellId).projectLeases, {
      kind: "projectLeases",
      value: leases,
    });
  }

  async projectLease(cellId: string, leaseId: string) {
    const leases = await this.storedProjectLeases(cellId);
    return leases.find((lease) => lease.leaseId === leaseId);
  }

  async releaseProjectLease(cellId: string, leaseId: string) {
    const leases = await this.storedProjectLeases(cellId);
    await this.storage.put(keysOf(cellId).projectLeases, {
      kind: "projectLeases",
      value: leases.filter((lease) => lease.leaseId !== leaseId),
    });
  }

  async cleanExpiredProjectLeases(now: number) {
    let removed = 0;
    for (const item of await this.storage.list()) {
      if (!item.key.endsWith("\0projectLeases")) continue;
      if (item.value.kind !== "projectLeases") continue;
      const leases = item.value.value;
      const remaining = leases.filter((lease) => lease.expiresAt > now);
      removed += leases.length - remaining.length;
      if (remaining.length === 0) await this.storage.delete(item.key);
      else {
        await this.storage.put(item.key, {
          kind: "projectLeases",
          value: remaining,
        });
      }
    }
    return removed;
  }

  async prepareOutbox(cellId: string, record: OutboxRecord) {
    const records = await this.storedOutbox(cellId);
    if (
      records.some(
        (candidate) => candidate.idempotencyKey === record.idempotencyKey,
      )
    ) {
      return false;
    }
    records.push(record);
    await this.storage.put(keysOf(cellId).outbox, {
      kind: "outbox",
      value: records,
    });
    return true;
  }

  async markOutboxDelivered(cellId: string, id: string) {
    await this.markOutbox(cellId, id, "delivered");
  }

  async markOutboxFailed(cellId: string, id: string, error: string) {
    const records = await this.storedOutbox(cellId);
    const record = records.find((candidate) => candidate.id === id);
    if (record) {
      record.state = "failed";
      record.attempts += 1;
      record.lastError = error.slice(0, 240);
    }
    await this.storage.put(keysOf(cellId).outbox, {
      kind: "outbox",
      value: records,
    });
  }

  async listOutbox(cellId: string, states?: OutboxRecordState[]) {
    const records = await this.storedOutbox(cellId);
    return states?.length
      ? records.filter((record) => states.includes(record.state))
      : [...records];
  }

  private async markOutbox(
    cellId: string,
    id: string,
    state: OutboxRecordState,
  ) {
    const records = await this.storedOutbox(cellId);
    const record = records.find((candidate) => candidate.id === id);
    if (record) {
      record.state = state;
      if (state === "delivered") record.deliveredAt = Date.now();
    }
    await this.storage.put(keysOf(cellId).outbox, {
      kind: "outbox",
      value: records,
    });
  }
}

/** A memory CellKVStore used for local conformance and as a DO-storage stand-in. */
export class MemoryCellKVStore implements CellKVStore {
  private readonly data = new Map<string, CellKVRecord>();

  get(key: string): Promise<CellKVRecord | undefined> {
    return Promise.resolve(this.data.get(key));
  }

  put(key: string, record: CellKVRecord): Promise<void> {
    this.data.set(key, record);
    return Promise.resolve();
  }

  delete(key: string): Promise<void> {
    this.data.delete(key);
    return Promise.resolve();
  }

  list() {
    return Promise.resolve(
      [...this.data.entries()].map(([key, value]) => ({ key, value })),
    );
  }
}

/**
 * A Cloudflare Durable Object cell. One logical object per agent deployment
 * and workspace; fresh-isolate execution over durable state. Git repositories
 * never enter DO storage — project work is delegated to an isolated execution
 * boundary through project leases.
 */
export class CloudflareCell implements AgentCell {
  constructor(
    readonly id: string,
    private readonly persistence: CellPersistence,
  ) {}

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
      this.persistence.lease(this.id),
      this.persistence.lastEvent(this.id),
    ]);
    const liveLease = lease && lease.expiresAt > Date.now() ? lease : undefined;
    return {
      state: liveLease ? "running" : "idle",
      lastEventId: lastEvent?.id,
      lastEventPosition: lastEvent?.position,
      lease: liveLease,
    };
  }

  async readState(key: string) {
    return await this.persistence.readState(this.id, key);
  }

  async writeState(key: string, value: CellStateValue): Promise<void> {
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
      branch: input.baseRef,
      expiresAt: Date.now() + (input.ttlMs ?? DEFAULT_PROJECT_LEASE_TTL_MS),
    };
    await this.persistence.saveProjectLease(this.id, lease);
    return lease;
  }

  async releaseProject(leaseId: string): Promise<void> {
    await this.persistence.releaseProjectLease(this.id, leaseId);
  }
}
