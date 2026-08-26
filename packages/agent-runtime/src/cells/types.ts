/** Durable agent cell contract types. The application depends on this
 * contract, never on Cloudflare, cellD, or desktop-specific APIs. */

import type { JsonObject, JsonValue } from "@chief/relay-contracts";

import type { AgentEvent as SessionAgentEvent } from "../types.js";

/** One ordered event delivered to a cell. */
export interface AgentEvent {
  /** Stable logical id. Replayed events reuse it; the cell ignores them. */
  id: string;
  type: string;
  payload?: JsonValue;
  /** Explicit idempotency key so retries do not duplicate side effects. */
  idempotencyKey: string;
  createdAt: number;
}

export interface EnqueueResult {
  accepted: boolean;
  duplicate: boolean;
  position: number;
}

export type AgentCellState = "idle" | "running" | "recovering" | "failed";

export interface RunLeaseState {
  runId: string;
  agentId: string;
  expiresAt: number;
}

export interface AgentCellStatus {
  state: AgentCellState;
  lastEventId?: string;
  lastEventPosition?: number;
  lastProgressAt?: number;
  lease?: RunLeaseState;
}

/** A small durable key-value scope owned by one cell. */
export type CellStateValue =
  string | number | boolean | null | JsonObject | SessionAgentEvent[];

/** A scheduled alarm for a cell. */
export interface AgentAlarm {
  id: string;
  at: number;
  payload?: JsonValue;
}

/** A request to lease project access for one run. */
export interface ProjectLeaseRequest {
  projectId: string;
  agentId: string;
  baseRef?: string;
  ttlMs?: number;
}

/** An active project lease for one run. */
export interface ProjectLease {
  leaseId: string;
  projectId: string;
  agentId: string;
  checkoutId?: string;
  branch?: string;
  expiresAt: number;
}

export type OutboxRecordState = "prepared" | "delivered" | "failed";

/** A transactional side-effect record committed before the tool acknowledges. */
export interface OutboxRecord {
  id: string;
  idempotencyKey: string;
  kind: string;
  payload?: JsonValue;
  state: OutboxRecordState;
  attempts: number;
  deliveredAt?: number;
  lastError?: string;
  createdAt: number;
}

/** A runtime adapter that supplies durable state, ordered events, alarms,
 * and isolated execution for one agent deployment. */
export interface AgentCell {
  readonly id: string;
  enqueue(event: AgentEvent): Promise<EnqueueResult>;
  getStatus(): Promise<AgentCellStatus>;
  readState(key: string): Promise<CellStateValue | undefined>;
  writeState(key: string, value: CellStateValue): Promise<void>;
  schedule(input: AgentAlarm): Promise<void>;
  cancelAlarm(id: string): Promise<void>;
  acquireProject(input: ProjectLeaseRequest): Promise<ProjectLease>;
  releaseProject(leaseId: string): Promise<void>;
}
