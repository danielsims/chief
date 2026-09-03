import type { AgentJob, Principal } from "@chief/relay-contracts";
import {
  agentJobListSchema,
  agentJobSchema,
  jobIdSchema,
} from "@chief/relay-contracts";

import { firstAgentRow } from "./agent-job-store";
import { HttpError } from "./http";

export function listAgentJobs(
  storage: DurableObjectStorage,
  principal: Principal,
) {
  requireJobAdministrator(principal);
  const jobs = Array.from(
    storage.sql.exec<{ job_json: string }>(
      `SELECT job_json FROM jobs
       ORDER BY updated_at DESC, rowid DESC LIMIT 200`,
    ),
    (row) => agentJobSchema.parse(JSON.parse(row.job_json)),
  );
  return agentJobListSchema.parse({ jobs });
}

export function retryAgentJob(
  storage: DurableObjectStorage,
  principal: Principal,
  rawJobId: string,
) {
  requireJobAdministrator(principal);
  const jobId = jobIdSchema.parse(decodeURIComponent(rawJobId));
  const row = firstAgentRow<{ job_json: string }>(
    storage.sql.exec("SELECT job_json FROM jobs WHERE job_id = ?", jobId),
  );
  if (!row) {
    throw new HttpError(
      404,
      "agent_job_not_found",
      "The agent run was not found.",
    );
  }
  const previous = agentJobSchema.parse(JSON.parse(row.job_json));
  if (previous.status !== "failed") {
    throw new HttpError(
      409,
      "agent_job_not_failed",
      "Only a failed agent run can be retried.",
    );
  }
  const now = new Date().toISOString();
  const job = agentJobSchema.parse({
    ...previous,
    status: "pending",
    attempt: 0,
    lastError: null,
    availableAt: now,
    leaseExpiresAt: null,
    updatedAt: now,
  });
  storage.sql.exec(
    `UPDATE jobs SET job_json = ?, status = 'pending', available_at = ?,
     lease_token = NULL, lease_expires_at = NULL, updated_at = ?
     WHERE job_id = ?`,
    JSON.stringify(job),
    now,
    now,
    job.id,
  );
  return job;
}

export function markJobFailed(
  storage: DurableObjectStorage,
  previous: AgentJob,
  now: string,
) {
  const job = agentJobSchema.parse({
    ...previous,
    status: "failed",
    lastError:
      previous.lastError ?? "Stopped after too many automatic retries.",
    leaseExpiresAt: null,
    updatedAt: now,
  });
  storage.sql.exec(
    `UPDATE jobs SET job_json = ?, status = 'failed', lease_token = NULL,
     lease_expires_at = NULL, updated_at = ? WHERE job_id = ?`,
    JSON.stringify(job),
    now,
    job.id,
  );
  return job;
}

function requireJobAdministrator(principal: Principal) {
  if (
    principal.kind !== "user" ||
    (principal.role !== "owner" && principal.role !== "admin")
  ) {
    throw new HttpError(
      403,
      "agent_job_administration_denied",
      "Only a workspace owner or admin can inspect and retry agent runs.",
    );
  }
}
