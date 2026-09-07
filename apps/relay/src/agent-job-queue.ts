import type {
  AgentPrincipal,
  JsonObject,
  WorkspaceId,
} from "@chief/relay-contracts";
import {
  agentJobCompletionResultSchema,
  agentJobSchema,
  claimAgentJobSchema,
  completeAgentJobSchema,
  enqueueAgentJobCommandSchema,
  messageIdSchema,
  parseJsonObject,
  renewAgentJobSchema,
} from "@chief/relay-contracts";

import type { readTrustedContext } from "./internal-context";
import {
  cancelAgentWorkflow,
  listAgentJobs,
  markJobFailed,
  retryAgentJob,
} from "./agent-job-administration";
import {
  actorPubkey,
  firstAgentRow,
  requireAgentOwnsJob,
  requireAgentPrincipal,
} from "./agent-job-store";
import { validateSpecialistKickoff } from "./agent-kickoff-verification";
import { publishAgentMessage } from "./agent-message-publisher";
import { publishOnboardingResult } from "./agent-onboarding";
import {
  HOSTED_JOB_MAX_ATTEMPTS,
  hostedAutomaticRetryAt,
} from "./agent-runtime-support";
import { HttpError, json, parseJson } from "./http";
import { jobsFindClaim } from "./queries/jobs/find-claim";
import { jobsFindComplete } from "./queries/jobs/find-complete";
import { jobsFindMaintainHostedLease } from "./queries/jobs/find-maintain-hosted-lease";
import { jobsFindNextAlarm } from "./queries/jobs/find-next-alarm";
import { jobsFindRefreshExisting } from "./queries/jobs/find-refresh-existing";
import { jobsFindRenew } from "./queries/jobs/find-renew";
import { jobsFindSupersedeConversation } from "./queries/jobs/find-supersede-conversation";
import { jobsInsertEnqueue } from "./queries/jobs/insert-enqueue";
import { jobsUpdateClaim } from "./queries/jobs/update-claim";
import { jobsUpdateComplete } from "./queries/jobs/update-complete";
import { updateJobReceipt } from "./queries/jobs/update-job-receipt";
import { jobsUpdateRenew } from "./queries/jobs/update-renew";
import { jobsUpdateSupersedeConversation } from "./queries/jobs/update-supersede-conversation";
import { receiptsFindEnqueue } from "./queries/receipts/find-enqueue";
import { receiptsInsertEnqueue } from "./queries/receipts/insert-enqueue";
import { receiptsUpdateUpdateReceipt } from "./queries/receipts/update-update-receipt";

type TrustedContext = ReturnType<typeof readTrustedContext>;
type AgentJob = ReturnType<typeof agentJobSchema.parse>;

export class AgentJobQueue {
  constructor(
    private readonly storage: DurableObjectStorage,
    private readonly env: Env,
    private readonly broadcast: (event: JsonObject) => void,
  ) {}

  async enqueue(
    request: Request,
    workspaceId: WorkspaceId,
    repairTerminal = false,
  ) {
    const command = enqueueAgentJobCommandSchema.parse(
      await parseJson(request),
    );
    const prior = firstAgentRow<{ job_json: string }>(
      receiptsFindEnqueue(this.storage, command.commandId),
    );
    if (prior) {
      return this.refreshExisting(command, prior.job_json, repairTerminal);
    }

    const now = command.occurredAt;
    const job = agentJobSchema.parse({
      ...command.payload,
      workspaceId,
      status: "pending",
      attempt: 0,
      lastError: null,
      leaseExpiresAt: null,
      createdAt: now,
      updatedAt: now,
    });
    this.storage.transactionSync(() => {
      jobsInsertEnqueue(this.storage, {
        jobId: job.id,
        jobJson: JSON.stringify(job),
        availableAt: job.availableAt,
        updatedAt: now,
      });
      receiptsInsertEnqueue(
        this.storage,
        command.commandId,
        JSON.stringify(job),
      );
    });
    if (Date.parse(job.availableAt) <= Date.now()) {
      this.broadcastAvailable(job, now);
      await this.scheduleHostedAlarm(job);
    } else {
      await this.scheduleNextAlarm();
    }
    return json({ duplicate: false, job });
  }

  async claim(request: Request, context: TrustedContext) {
    requireAgentPrincipal(context.principal);
    const input = claimAgentJobSchema.parse(await parseJson(request));
    const now = new Date();
    const candidate = firstAgentRow<{ job_id: string; job_json: string }>(
      jobsFindClaim(this.storage, now.toISOString(), now.toISOString()),
    );
    if (!candidate) {
      await this.scheduleNextAlarm();
      return new Response(null, { status: 204 });
    }

    const leaseToken = crypto.randomUUID();
    const leaseExpiresAt = new Date(
      now.getTime() + input.leaseSeconds * 1_000,
    ).toISOString();
    const previous = agentJobSchema.parse(JSON.parse(candidate.job_json));
    requireAgentOwnsJob(context.principal, previous.agentId);
    if (previous.attempt >= HOSTED_JOB_MAX_ATTEMPTS) {
      return await this.exhaustAutomaticRetries(previous, now.toISOString());
    }
    const job = agentJobSchema.parse({
      ...previous,
      status: "leased",
      attempt: previous.attempt + 1,
      leaseExpiresAt,
      updatedAt: now.toISOString(),
    });
    jobsUpdateClaim(this.storage, {
      jobJson: JSON.stringify(job),
      leaseToken: leaseToken,
      leaseExpiresAt: leaseExpiresAt,
      updatedAt: now.toISOString(),
      jobId: job.id,
    });
    await this.scheduleNextAlarm();
    return json({ job, leaseToken });
  }

  async complete(request: Request, context: TrustedContext) {
    requireAgentPrincipal(context.principal);
    const input = completeAgentJobSchema.parse(await parseJson(request));
    const row = firstAgentRow<{ job_id: string; job_json: string }>(
      jobsFindComplete(this.storage, input.leaseToken),
    );
    if (!row) {
      throw new HttpError(
        409,
        "stale_lease",
        "The agent lease is no longer active.",
      );
    }
    const previous = agentJobSchema.parse(JSON.parse(row.job_json));
    requireAgentOwnsJob(context.principal, previous.agentId);
    const now = new Date().toISOString();
    const retryAt =
      input.outcome.status === "failed" && input.outcome.retryAt
        ? hostedAutomaticRetryAt(previous.attempt, input.outcome.error)
          ? input.outcome.retryAt
          : undefined
        : undefined;
    let job = agentJobSchema.parse({
      ...previous,
      status: retryAt ? "pending" : input.outcome.status,
      lastError: input.outcome.status === "failed" ? input.outcome.error : null,
      availableAt: retryAt ?? previous.availableAt,
      leaseExpiresAt: null,
      updatedAt: now,
    });
    const result =
      job.status === "completed" && input.outcome.status === "completed"
        ? agentJobCompletionResultSchema.parse(input.outcome.result)
        : null;
    try {
      if (result?.publishedMessage && job.kind !== "workspace.onboarding") {
        if (job.kind.startsWith("workspace.kickoff.")) {
          await validateSpecialistKickoff(this.env, job, context.principal);
        }
        await publishAgentMessage(
          this.env,
          job,
          result.publishedMessage,
          job.id,
          actorPubkey(context.principal),
        );
      }
      if (result && job.kind === "workspace.onboarding") {
        await publishOnboardingResult(
          this.env,
          job,
          context.principal,
          parseJsonObject(result) ?? {},
          (targetJob, message, commandId, pubkey) =>
            publishAgentMessage(
              this.env,
              targetJob,
              message,
              commandId,
              pubkey,
            ),
        );
      }
    } catch (cause) {
      job = agentJobSchema.parse({
        ...job,
        status: "failed",
        lastError: parsePersistedJobError(cause),
        availableAt: previous.availableAt,
      });
    }
    jobsUpdateComplete(this.storage, {
      jobJson: JSON.stringify(job),
      status: job.status,
      availableAt: job.availableAt,
      updatedAt: now,
      jobId: job.id,
      leaseToken: input.leaseToken,
    });
    if (job.status === "pending" && Date.parse(job.availableAt) <= Date.now()) {
      this.broadcastAvailable(job, now);
    } else {
      await this.scheduleNextAlarm();
    }
    return json({ job, outcome: input.outcome });
  }

  private async exhaustAutomaticRetries(previous: AgentJob, now: string) {
    markJobFailed(this.storage, previous, now);
    await this.scheduleNextAlarm();
    return new Response(null, { status: 204 });
  }

  async renew(request: Request, context: TrustedContext) {
    requireAgentPrincipal(context.principal);
    const input = renewAgentJobSchema.parse(await parseJson(request));
    const row = firstAgentRow<{ job_json: string }>(
      jobsFindRenew(this.storage, input.leaseToken),
    );
    if (!row) {
      throw new HttpError(
        409,
        "stale_lease",
        "The agent lease is no longer active.",
      );
    }
    const job = agentJobSchema.parse(JSON.parse(row.job_json));
    requireAgentOwnsJob(context.principal, job.agentId);
    const leaseExpiresAt = new Date(
      Date.now() + input.leaseSeconds * 1_000,
    ).toISOString();
    jobsUpdateRenew(this.storage, {
      leaseExpiresAt: leaseExpiresAt,
      jobId: job.id,
      leaseToken: input.leaseToken,
    });
    await this.scheduleNextAlarm();
    return json({ leaseExpiresAt });
  }

  supersedeConversation(conversationId: string, replacementJobId: string) {
    const now = new Date().toISOString();
    const superseded: string[] = [];
    for (const row of jobsFindSupersedeConversation<{ job_json: string }>(
      this.storage,
    )) {
      const previous = agentJobSchema.parse(JSON.parse(row.job_json));
      if (
        previous.id === replacementJobId ||
        previous.kind !== "conversation.message" ||
        previous.payload.conversationId !== conversationId
      ) {
        continue;
      }
      const job = agentJobSchema.parse({
        ...previous,
        status: "completed",
        leaseExpiresAt: null,
        updatedAt: now,
      });
      jobsUpdateSupersedeConversation(this.storage, {
        jobJson: JSON.stringify(job),
        updatedAt: now,
        jobId: job.id,
      });
      superseded.push(job.id);
    }
    return superseded;
  }

  maintainHostedLease(
    jobId: string,
    currentToken: string,
    principal: AgentPrincipal,
    leaseSeconds: number,
  ) {
    const row = firstAgentRow<{
      job_json: string;
      status: string;
      lease_token: string | null;
      lease_expires_at: string | null;
    }>(jobsFindMaintainHostedLease(this.storage, jobId));
    if (!row || row.status === "completed" || row.status === "failed") {
      return undefined;
    }
    const previous = agentJobSchema.parse(JSON.parse(row.job_json));
    requireAgentOwnsJob(principal, previous.agentId);
    const now = new Date();
    const leaseActive =
      row.status === "leased" &&
      row.lease_token !== null &&
      row.lease_expires_at !== null &&
      Date.parse(row.lease_expires_at) > now.getTime();
    if (leaseActive && row.lease_token !== currentToken) return undefined;
    if (!leaseActive && previous.attempt >= HOSTED_JOB_MAX_ATTEMPTS) {
      markJobFailed(this.storage, previous, now.toISOString());
      return undefined;
    }
    const leaseToken = leaseActive
      ? (row.lease_token ?? currentToken)
      : crypto.randomUUID();
    const leaseExpiresAt = new Date(
      now.getTime() + leaseSeconds * 1_000,
    ).toISOString();
    const job = agentJobSchema.parse({
      ...previous,
      status: "leased",
      attempt: leaseActive ? previous.attempt : previous.attempt + 1,
      leaseExpiresAt,
      updatedAt: now.toISOString(),
    });
    jobsUpdateClaim(this.storage, {
      jobJson: JSON.stringify(job),
      leaseToken: leaseToken,
      leaseExpiresAt: leaseExpiresAt,
      updatedAt: job.updatedAt,
      jobId: job.id,
    });
    return { job, leaseToken };
  }

  list(context: TrustedContext, workflowId?: string) {
    return json(listAgentJobs(this.storage, context.principal, workflowId));
  }

  async cancelWorkflow(request: Request, context: TrustedContext) {
    const input = parseJsonObject(await parseJson(request));
    const workflowId = messageIdSchema.parse(input?.workflowId);
    cancelAgentWorkflow(this.storage, context.principal, workflowId);
    await this.scheduleNextAlarm();
    return new Response(null, { status: 204 });
  }

  retry(request: Request, context: TrustedContext) {
    const segments = new URL(request.url).pathname.split("/").filter(Boolean);
    const retryIndex = segments.lastIndexOf("retry");
    const job = retryAgentJob(
      this.storage,
      context.principal,
      segments[retryIndex - 1] ?? "",
    );
    this.broadcastAvailable(job, job.updatedAt);
    return json({ job });
  }

  async scheduleNextAlarm() {
    const row = firstAgentRow<{ next_at: string | null }>(
      jobsFindNextAlarm(this.storage),
    );
    if (!row?.next_at) {
      await this.storage.deleteAlarm();
      return;
    }
    const next = Date.parse(row.next_at);
    if (Number.isFinite(next)) {
      await this.storage.setAlarm(Math.max(next, Date.now() + 50));
    }
  }

  private async refreshExisting(
    command: ReturnType<typeof enqueueAgentJobCommandSchema.parse>,
    jobJson: string,
    repairTerminal: boolean,
  ) {
    const priorJob = agentJobSchema.parse(JSON.parse(jobJson));
    const now = new Date().toISOString();
    const refreshed = agentJobSchema.parse({
      ...priorJob,
      payload: { ...priorJob.payload, ...command.payload.payload },
      updatedAt: now,
    });
    const stored = firstAgentRow<{ status: string }>(
      jobsFindRefreshExisting(this.storage, priorJob.id),
    );
    if (
      repairTerminal &&
      priorJob.kind === "workspace.onboarding" &&
      (stored?.status === "failed" || stored?.status === "completed")
    ) {
      const repaired = agentJobSchema.parse({
        ...refreshed,
        status: "pending",
        attempt: 0,
        lastError: null,
        availableAt: now,
        leaseExpiresAt: null,
      });
      this.updateReceipt(command.commandId, repaired, true);
      this.broadcastAvailable(repaired, now);
      await this.scheduleHostedAlarm(repaired);
      return json({ duplicate: false, repaired: true, job: repaired });
    }
    if (repairTerminal && stored?.status === "pending") {
      this.updateReceipt(command.commandId, refreshed, false);
      if (Date.parse(refreshed.availableAt) <= Date.now()) {
        this.broadcastAvailable(refreshed, now);
      }
      await this.scheduleHostedAlarm(refreshed);
      return json({ duplicate: true, refreshed: true, job: refreshed });
    }
    return json({ duplicate: true, job: priorJob });
  }

  private updateReceipt(commandId: string, job: AgentJob, reset: boolean) {
    this.storage.transactionSync(() => {
      updateJobReceipt(this.storage, {
        jobId: job.id,
        jobJson: JSON.stringify(job),
        availableAt: job.availableAt,
        updatedAt: job.updatedAt,
        reset,
      });
      receiptsUpdateUpdateReceipt(this.storage, JSON.stringify(job), commandId);
    });
  }

  private broadcastAvailable(job: AgentJob, occurredAt: string) {
    this.broadcast({
      type: "agent.job.available",
      occurredAt,
      payload: { agentId: job.agentId, jobId: job.id, kind: job.kind },
    });
  }

  private async scheduleHostedAlarm(job: AgentJob) {
    if (this.env.HOSTED_CELL_ENABLED !== "true") return;
    const availableAt = Date.parse(job.availableAt);
    await this.storage.setAlarm(
      Math.max(
        Number.isFinite(availableAt) ? availableAt : Date.now(),
        Date.now() + 2_000,
      ),
    );
  }
}

function parsePersistedJobError(value: unknown) {
  return value instanceof Error
    ? value.message.slice(0, 4_000)
    : "The agent result could not be saved.";
}
