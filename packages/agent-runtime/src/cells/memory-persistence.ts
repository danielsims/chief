/* eslint-disable @typescript-eslint/require-await -- sync implementation of an async interface */
import type { CellPersistence, EnqueueOutcome } from "./sqlite-store.js";
import type {
  AgentAlarm,
  AgentEvent,
  OutboxRecord,
  OutboxRecordState,
  ProjectLease,
  RunLeaseState,
} from "./types.js";

/**
 * In-memory CellPersistence used as the reference for adapter conformance and
 * as a stand-in for Durable Object storage during local tests. It matches the
 * same ordered, deduplicated semantics as the SQLite store.
 */
export class MemoryCellPersistence implements CellPersistence {
  private readonly eventsByCell = new Map<string, AgentEvent[]>();
  private readonly positionsByCell = new Map<string, number>();
  private readonly stateByCell = new Map<string, Map<string, unknown>>();
  private readonly alarmsByCell = new Map<string, AgentAlarm[]>();
  private readonly leasesByCell = new Map<string, RunLeaseState>();
  private readonly projectLeasesByCell = new Map<string, ProjectLease[]>();
  private readonly outboxByCell = new Map<string, OutboxRecord[]>();

  async enqueue(cellId: string, event: AgentEvent): Promise<EnqueueOutcome> {
    const events = this.eventsByCell.get(cellId) ?? [];
    const existing = events.find(
      (candidate) => candidate.idempotencyKey === event.idempotencyKey,
    );
    if (existing) {
      const position = events.indexOf(existing) + 1;
      return { duplicate: true, position };
    }
    events.push(event);
    this.eventsByCell.set(cellId, events);
    this.positionsByCell.set(cellId, events.length);
    return { duplicate: false, position: events.length };
  }

  async lastEvent(cellId: string) {
    const events = this.eventsByCell.get(cellId) ?? [];
    const last = events.at(-1);
    return last ? { id: last.id, position: events.length } : undefined;
  }

  async events(cellId: string, afterPosition?: number) {
    const events = this.eventsByCell.get(cellId) ?? [];
    return afterPosition ? events.slice(afterPosition) : [...events];
  }

  async readState(cellId: string, key: string) {
    return this.stateByCell.get(cellId)?.get(key);
  }

  async writeState(cellId: string, key: string, value: unknown) {
    const store = this.stateByCell.get(cellId) ?? new Map<string, unknown>();
    store.set(key, value);
    this.stateByCell.set(cellId, store);
  }

  async listDueAlarms(cellId: string, now: number) {
    return (this.alarmsByCell.get(cellId) ?? []).filter(
      (alarm) => alarm.at <= now,
    );
  }

  async saveAlarm(cellId: string, alarm: AgentAlarm) {
    const alarms = this.alarmsByCell.get(cellId) ?? [];
    const existing = alarms.findIndex((candidate) => candidate.id === alarm.id);
    if (existing >= 0) alarms[existing] = alarm;
    else alarms.push(alarm);
    this.alarmsByCell.set(cellId, alarms);
  }

  async deleteAlarm(cellId: string, alarmId: string) {
    this.alarmsByCell.set(
      cellId,
      (this.alarmsByCell.get(cellId) ?? []).filter(
        (alarm) => alarm.id !== alarmId,
      ),
    );
  }

  async acquireLease(cellId: string, lease: RunLeaseState) {
    const active = this.leasesByCell.get(cellId);
    if (
      active &&
      active.expiresAt > Date.now() &&
      active.runId !== lease.runId
    ) {
      return false;
    }
    this.leasesByCell.set(cellId, lease);
    return true;
  }

  async lease(cellId: string) {
    return this.leasesByCell.get(cellId);
  }

  async releaseLease(cellId: string, runId: string) {
    const current = this.leasesByCell.get(cellId);
    if (current?.runId === runId) this.leasesByCell.delete(cellId);
  }

  async expireLeases(now: number) {
    let removed = 0;
    for (const [cellId, lease] of this.leasesByCell) {
      if (lease.expiresAt <= now) {
        this.leasesByCell.delete(cellId);
        removed += 1;
      }
    }
    return removed;
  }

  async saveProjectLease(cellId: string, lease: ProjectLease) {
    const leases = this.projectLeasesByCell.get(cellId) ?? [];
    leases.push(lease);
    this.projectLeasesByCell.set(cellId, leases);
  }

  async projectLease(cellId: string, leaseId: string) {
    return (this.projectLeasesByCell.get(cellId) ?? []).find(
      (lease) => lease.leaseId === leaseId,
    );
  }

  async releaseProjectLease(cellId: string, leaseId: string) {
    this.projectLeasesByCell.set(
      cellId,
      (this.projectLeasesByCell.get(cellId) ?? []).filter(
        (lease) => lease.leaseId !== leaseId,
      ),
    );
  }

  async cleanExpiredProjectLeases(now: number) {
    let removed = 0;
    for (const [cellId, leases] of this.projectLeasesByCell) {
      const remaining = leases.filter((lease) => lease.expiresAt > now);
      removed += leases.length - remaining.length;
      this.projectLeasesByCell.set(cellId, remaining);
    }
    return removed;
  }

  async prepareOutbox(cellId: string, record: OutboxRecord): Promise<boolean> {
    const records = this.outboxByCell.get(cellId) ?? [];
    if (
      records.some(
        (candidate) => candidate.idempotencyKey === record.idempotencyKey,
      )
    ) {
      return false;
    }
    records.push(record);
    this.outboxByCell.set(cellId, records);
    return true;
  }

  async markOutboxDelivered(cellId: string, id: string) {
    await this.markOutbox(cellId, id, "delivered");
  }

  async markOutboxFailed(cellId: string, id: string, error: string) {
    const records = this.outboxByCell.get(cellId) ?? [];
    const record = records.find((candidate) => candidate.id === id);
    if (record) {
      record.state = "failed";
      record.attempts += 1;
      record.lastError = error.slice(0, 240);
    }
  }

  async listOutbox(cellId: string, states?: OutboxRecordState[]) {
    const records = this.outboxByCell.get(cellId) ?? [];
    return states?.length
      ? records.filter((record) => states.includes(record.state))
      : [...records];
  }

  private async markOutbox(
    cellId: string,
    id: string,
    state: OutboxRecordState,
  ) {
    const records = this.outboxByCell.get(cellId) ?? [];
    const record = records.find((candidate) => candidate.id === id);
    if (record) {
      record.state = state;
      if (state === "delivered") record.deliveredAt = Date.now();
    }
  }
}
