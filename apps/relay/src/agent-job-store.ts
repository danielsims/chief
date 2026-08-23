import type { AgentPrincipal, Principal } from "@chief/relay-contracts";

import { HttpError } from "./http";

export function initializeAgentJobs(storage: DurableObjectStorage) {
  storage.sql.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      job_id TEXT PRIMARY KEY,
      job_json TEXT NOT NULL,
      status TEXT NOT NULL,
      available_at TEXT NOT NULL,
      lease_token TEXT UNIQUE,
      lease_expires_at TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS jobs_claim_idx
      ON jobs (status, available_at, lease_expires_at);
    CREATE TABLE IF NOT EXISTS receipts (
      command_id TEXT PRIMARY KEY,
      job_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS cell_records (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
}

export function firstAgentRow<T>(cursor: Iterable<T>): T | undefined {
  return cursor[Symbol.iterator]().next().value as T | undefined;
}

export function actorPubkey(principal: Principal): string | undefined {
  return principal.kind === "agent" || principal.kind === "user"
    ? principal.pubkey
    : undefined;
}

export function requireAgentPrincipal(
  principal: Principal,
): asserts principal is AgentPrincipal {
  if (principal.kind !== "agent") {
    throw new HttpError(
      403,
      "agent_required",
      "An agent identity is required for mailbox work.",
    );
  }
}

export function requireAgentOwnsJob(
  principal: AgentPrincipal,
  agentId: string,
) {
  if (principal.agentId !== agentId) {
    throw new HttpError(
      403,
      "agent_job_access_denied",
      "An agent can only work jobs from its own mailbox.",
    );
  }
}
