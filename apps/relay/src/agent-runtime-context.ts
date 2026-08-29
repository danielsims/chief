import type { DurableTurnRunner } from "@chief/agent-runtime/durable-turn";
import type { AgentJob } from "@chief/relay-contracts";
import { agentJobSchema, isJsonString } from "@chief/relay-contracts";

import { firstAgentRow } from "./agent-job-store";
import { agentWorkflowId } from "./agent-tracing";
import { telemetryIncludesContent } from "./effect";

export function agentTraceContext(
  env: Env,
  job: AgentJob,
  workspaceName: string,
) {
  return {
    workspaceId: job.workspaceId,
    workspaceName,
    agentId: job.agentId,
    conversationId: isJsonString(job.payload.conversationId)
      ? job.payload.conversationId
      : "mission-control",
    jobId: job.id,
    workflowId: agentWorkflowId(job),
    messageId: isJsonString(job.payload.messageId)
      ? job.payload.messageId
      : undefined,
    includeContent: telemetryIncludesContent(env),
  };
}

export function loadAgentJob(storage: DurableObjectStorage, jobId: string) {
  const row = firstAgentRow<{ job_json: string }>(
    storage.sql.exec("SELECT job_json FROM jobs WHERE job_id = ?", jobId),
  );
  return row ? agentJobSchema.parse(JSON.parse(row.job_json)) : undefined;
}

export async function currentAgentWorkflowId(
  storage: DurableObjectStorage,
  turns: DurableTurnRunner,
) {
  const active = await turns.active();
  if (active) {
    const job = loadAgentJob(storage, active.jobId);
    return job ? agentWorkflowId(job) : undefined;
  }
  const now = new Date().toISOString();
  const due = firstAgentRow<{ job_json: string }>(
    storage.sql.exec(
      `SELECT job_json FROM jobs
       WHERE (status = 'pending' AND available_at <= ?)
          OR (status = 'leased' AND lease_expires_at <= ?)
       ORDER BY available_at ASC, rowid ASC LIMIT 1`,
      now,
      now,
    ),
  );
  return due
    ? agentWorkflowId(agentJobSchema.parse(JSON.parse(due.job_json)))
    : undefined;
}
