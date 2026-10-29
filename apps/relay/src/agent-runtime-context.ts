import type { DurableTurnRunner } from "@chief/agent-runtime/durable-turn";
import type { AgentJob } from "@chief/relay-contracts";
import { agentJobSchema, isJsonString } from "@chief/relay-contracts";

import { firstAgentRow } from "./agent-job-store";
import { agentWorkflowId } from "./agent-tracing";
import { telemetryIncludesContent } from "./effect";
import { jobsFindCurrentAgentWorkflowId } from "./queries/jobs/find-current-agent-workflow-id";
import { jobsFindRetryAgentJob } from "./queries/jobs/find-retry-agent-job";

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
    jobKind: job.kind,
    threadRootId: isJsonString(job.payload.threadRootId)
      ? job.payload.threadRootId
      : undefined,
    scheduleId: isJsonString(job.payload.scheduleId)
      ? job.payload.scheduleId
      : undefined,
    scheduleRunId: isJsonString(job.payload.scheduleRunId)
      ? job.payload.scheduleRunId
      : undefined,
    scheduleStepId: isJsonString(job.payload.scheduleStepId)
      ? job.payload.scheduleStepId
      : undefined,
    includeContent: telemetryIncludesContent(env),
  };
}

export function loadAgentJob(storage: DurableObjectStorage, jobId: string) {
  const row = firstAgentRow<{ job_json: string }>(
    jobsFindRetryAgentJob(storage, jobId),
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
    jobsFindCurrentAgentWorkflowId(storage, now, now),
  );
  return due
    ? agentWorkflowId(agentJobSchema.parse(JSON.parse(due.job_json)))
    : undefined;
}
