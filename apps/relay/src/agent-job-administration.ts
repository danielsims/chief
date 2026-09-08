import type { AgentJob, Principal } from "@chief/relay-contracts";
import {
  agentJobListSchema,
  agentJobSchema,
  jobIdSchema,
} from "@chief/relay-contracts";

import { firstAgentRow } from "./agent-job-store";
import { HttpError } from "./http";
import { jobsFindCancelAgentWorkflow } from "./queries/jobs/find-cancel-agent-workflow";
import { jobsFindListAgentJobs } from "./queries/jobs/find-list-agent-jobs";
import { jobsFindRetryAgentJob } from "./queries/jobs/find-retry-agent-job";
import { jobsUpdateMarkJobFailed } from "./queries/jobs/update-mark-job-failed";
import { jobsUpdateRetryAgentJob } from "./queries/jobs/update-retry-agent-job";

export function listAgentJobs(
  storage: DurableObjectStorage,
  principal: Principal,
  workflowId?: string,
) {
  requireJobAdministrator(principal);
  const jobs = Array.from(
    jobsFindListAgentJobs<{ job_json: string }>(
      storage,
      workflowId ?? null,
      workflowId ?? null,
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
    jobsFindRetryAgentJob(storage, jobId),
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
  jobsUpdateRetryAgentJob(storage, {
    jobJson: JSON.stringify(job),
    availableAt: now,
    updatedAt: now,
    jobId: job.id,
  });
  return job;
}

export function cancelAgentWorkflow(
  storage: DurableObjectStorage,
  principal: Principal,
  workflowId: string,
) {
  requireJobAdministrator(principal);
  const now = new Date().toISOString();
  for (const row of jobsFindCancelAgentWorkflow<{ job_json: string }>(
    storage,
    workflowId,
  )) {
    const job = agentJobSchema.parse(JSON.parse(row.job_json));
    markJobFailed(
      storage,
      { ...job, lastError: "This scheduled run was stopped." },
      now,
    );
  }
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
  jobsUpdateMarkJobFailed(storage, {
    jobJson: JSON.stringify(job),
    updatedAt: now,
    jobId: job.id,
  });
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
