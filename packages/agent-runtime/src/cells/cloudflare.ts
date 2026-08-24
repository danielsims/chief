/* eslint-disable @typescript-eslint/require-await -- sync implementation of an async interface */
import { randomUUID } from "node:crypto";

import type { CellPersistence, EnqueueOutcome } from "./sqlite-store.js";
import type {
  AgentAlarm,
  AgentCell,
  AgentCellStatus,
  AgentEvent,
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
export interface CellKVStore {
  get<T = unknown>(key: string): Promise<T | undefined>;
  put<T = unknown>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
  list(): Promise<{ key: string; value: unknown }[]>;
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

  async enqueue(cellId: string, event: AgentEvent): Promise<EnqueueOutcome> {
    const events =
      (await this.storage.get<AgentEvent[]>(keysOf(cellId).events)) ?? [];
    const existing = events.find(
      (candidate) => candidate.idempotencyKey === event.idempotencyKey,
    );
    if (existing) {
      return { duplicate: true, position: events.indexOf(existing) + 1 };
    }
    events.push(event);
    await this.storage.put(keysOf(cellId).events, events);
    return { duplicate: false, position: events.length };
  }

  async lastEvent(cellId: string) {
    const events =
      (await this.storage.get<AgentEvent[]>(keysOf(cellId).events)) ?? [];
    const last = events.at(-1);
    return last ? { id: last.id, position: events.length } : undefined;
  }

  async events(cellId: string, afterPosition?: number) {
    const events =
      (await this.storage.get<AgentEvent[]>(keysOf(cellId).events)) ?? [];
    return afterPosition ? events.slice(afterPosition) : [...events];
  }

  async readState(cellId: string, key: string) {
    const state =
      (await this.storage.get<Record<string, unknown>>(keysOf(cellId).state)) ??
      {};
    return state[key];
  }

  async writeState(cellId: string, key: string, value: unknown) {
    const state =
      (await this.storage.get<Record<string, unknown>>(keysOf(cellId).state)) ??
      {};
    state[key] = value;
    await this.storage.put(keysOf(cellId).state, state);
  }

  async listDueAlarms(cellId: string, now: number) {
    const alarms =
      (await this.storage.get<AgentAlarm[]>(keysOf(cellId).alarms)) ?? [];
    return alarms.filter((alarm) => alarm.at <= now);
  }

  async saveAlarm(cellId: string, alarm: AgentAlarm) {
    const alarms =
      (await this.storage.get<AgentAlarm[]>(keysOf(cellId).alarms)) ?? [];
    const index = alarms.findIndex((candidate) => candidate.id === alarm.id);
    if (index >= 0) alarms[index] = alarm;
    else alarms.push(alarm);
    await this.storage.put(keysOf(cellId).alarms, alarms);
  }

  async deleteAlarm(cellId: string, alarmId: string) {
    const alarms =
      (await this.storage.get<AgentAlarm[]>(keysOf(cellId).alarms)) ?? [];
    await this.storage.put(
      keysOf(cellId).alarms,
      alarms.filter((alarm) => alarm.id !== alarmId),
    );
  }

  async acquireLease(cellId: string, lease: RunLeaseState) {
    const current = await this.storage.get<RunLeaseState>(keysOf(cellId).lease);
    if (
      current &&
      current.expiresAt > Date.now() &&
      current.runId !== lease.runId
    ) {
      return false;
    }
    await this.storage.put(keysOf(cellId).lease, lease);
    return true;
  }

  async lease(cellId: string) {
    return this.storage.get<RunLeaseState>(keysOf(cellId).lease);
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
      const value = item.value as RunLeaseState | undefined;
      if (
        value &&
        typeof value === "object" &&
        "expiresAt" in value &&
        (value as { expiresAt: number }).expiresAt <= now
      ) {
        await this.storage.delete(item.key);
        removed += 1;
      }
    }
    return removed;
  }

  async saveProjectLease(cellId: string, lease: ProjectLease) {
    const leases =
      (await this.storage.get<ProjectLease[]>(keysOf(cellId).projectLeases)) ??
      [];
    leases.push(lease);
    await this.storage.put(keysOf(cellId).projectLeases, leases);
  }

  async projectLease(cellId: string, leaseId: string) {
    const leases =
      (await this.storage.get<ProjectLease[]>(keysOf(cellId).projectLeases)) ??
      [];
    return leases.find((lease) => lease.leaseId === leaseId);
  }

  async releaseProjectLease(cellId: string, leaseId: string) {
    const leases =
      (await this.storage.get<ProjectLease[]>(keysOf(cellId).projectLeases)) ??
      [];
    await this.storage.put(
      keysOf(cellId).projectLeases,
      leases.filter((lease) => lease.leaseId !== leaseId),
    );
  }

  async cleanExpiredProjectLeases(now: number) {
    let removed = 0;
    for (const item of await this.storage.list()) {
      if (!item.key.endsWith("\0projectLeases")) continue;
      const leases = item.value as ProjectLease[] | undefined;
      if (!Array.isArray(leases)) continue;
      const remaining = leases.filter((lease) => lease.expiresAt > now);
      removed += leases.length - remaining.length;
      if (remaining.length === 0) await this.storage.delete(item.key);
      else await this.storage.put(item.key, remaining);
    }
    return removed;
  }

  async prepareOutbox(cellId: string, record: OutboxRecord) {
    const records =
      (await this.storage.get<OutboxRecord[]>(keysOf(cellId).outbox)) ?? [];
    if (
      records.some(
        (candidate) => candidate.idempotencyKey === record.idempotencyKey,
      )
    ) {
      return false;
    }
    records.push(record);
    await this.storage.put(keysOf(cellId).outbox, records);
    return true;
  }

  async markOutboxDelivered(cellId: string, id: string) {
    await this.markOutbox(cellId, id, "delivered");
  }

  async markOutboxFailed(cellId: string, id: string, error: string) {
    const records =
      (await this.storage.get<OutboxRecord[]>(keysOf(cellId).outbox)) ?? [];
    const record = records.find((candidate) => candidate.id === id);
    if (record) {
      record.state = "failed";
      record.attempts += 1;
      record.lastError = error.slice(0, 240);
    }
    await this.storage.put(keysOf(cellId).outbox, records);
  }

  async listOutbox(cellId: string, states?: OutboxRecordState[]) {
    const records =
      (await this.storage.get<OutboxRecord[]>(keysOf(cellId).outbox)) ?? [];
    return states?.length
      ? records.filter((record) => states.includes(record.state))
      : [...records];
  }

  private async markOutbox(
    cellId: string,
    id: string,
    state: OutboxRecordState,
  ) {
    const records =
      (await this.storage.get<OutboxRecord[]>(keysOf(cellId).outbox)) ?? [];
    const record = records.find((candidate) => candidate.id === id);
    if (record) {
      record.state = state;
      if (state === "delivered") record.deliveredAt = Date.now();
    }
    await this.storage.put(keysOf(cellId).outbox, records);
  }
}

/** A memory CellKVStore used for local conformance and as a DO-storage stand-in. */
export class MemoryCellKVStore implements CellKVStore {
  private readonly data = new Map<string, unknown>();

  async get<T>(key: string): Promise<T | undefined> {
    return this.data.get(key) as T | undefined;
  }

  async put<T>(key: string, value: T): Promise<void> {
    this.data.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.data.delete(key);
  }

  async list() {
    return [...this.data.entries()].map(([key, value]) => ({ key, value }));
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
      ...(lastEvent ? { lastEventId: lastEvent.id } : {}),
      ...(lastEvent ? { lastEventPosition: lastEvent.position } : {}),
      ...(liveLease ? { lease: liveLease } : {}),
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
}
