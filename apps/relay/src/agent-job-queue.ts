import type { JsonObject, WorkspaceId } from "@chief/relay-contracts";
import {
  agentJobCompletionResultSchema,
  agentJobSchema,
  claimAgentJobSchema,
  completeAgentJobSchema,
  enqueueAgentJobCommandSchema,
  parseJsonObject,
  renewAgentJobSchema,
} from "@chief/relay-contracts";

import type { readTrustedContext } from "./internal-context";
import { listAgentJobs, retryAgentJob } from "./agent-job-administration";
import {
  actorPubkey,
  firstAgentRow,
  requireAgentOwnsJob,
  requireAgentPrincipal,
} from "./agent-job-store";
import { validateSpecialistKickoff } from "./agent-kickoff-verification";
import { publishAgentMessage } from "./agent-message-publisher";
import { publishOnboardingResult } from "./agent-onboarding";
import { HttpError, json, parseJson } from "./http";

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
      this.storage.sql.exec(
        "SELECT job_json FROM receipts WHERE command_id = ?",
        command.commandId,
      ),
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
      this.storage.sql.exec(
        `INSERT INTO jobs (
          job_id, job_json, status, available_at, lease_token, lease_expires_at,
          updated_at
        ) VALUES (?, ?, 'pending', ?, NULL, NULL, ?)`,
        job.id,
        JSON.stringify(job),
        job.availableAt,
        now,
      );
      this.storage.sql.exec(
        "INSERT INTO receipts (command_id, job_json) VALUES (?, ?)",
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
      this.storage.sql.exec(
        `SELECT job_id, job_json FROM jobs
         WHERE (status = 'pending' AND available_at <= ?)
            OR (status = 'leased' AND lease_expires_at <= ?)
         ORDER BY available_at ASC, rowid ASC LIMIT 1`,
        now.toISOString(),
        now.toISOString(),
      ),
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
    const job = agentJobSchema.parse({
      ...previous,
      status: "leased",
      attempt: previous.attempt + 1,
      leaseExpiresAt,
      updatedAt: now.toISOString(),
    });
    this.storage.sql.exec(
      `UPDATE jobs SET job_json = ?, status = 'leased', lease_token = ?,
       lease_expires_at = ?, updated_at = ? WHERE job_id = ?`,
      JSON.stringify(job),
      leaseToken,
      leaseExpiresAt,
      now.toISOString(),
      job.id,
    );
    await this.scheduleNextAlarm();
    return json({ job, leaseToken });
  }

  async complete(request: Request, context: TrustedContext) {
    requireAgentPrincipal(context.principal);
    const input = completeAgentJobSchema.parse(await parseJson(request));
    const row = firstAgentRow<{ job_id: string; job_json: string }>(
      this.storage.sql.exec(
        "SELECT job_id, job_json FROM jobs WHERE lease_token = ? AND status = 'leased'",
        input.leaseToken,
      ),
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
      input.outcome.status === "failed" ? input.outcome.retryAt : undefined;
    const job = agentJobSchema.parse({
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
    if (result?.publishedMessage && job.kind !== "workspace.onboarding") {
      if (job.kind.startsWith("workspace.kickoff.")) {
        await validateSpecialistKickoff(this.env, job, context.principal);
      }
      await publishAgentMessage(
        this.env,
        job,
        result.publishedMessage,
        crypto.randomUUID(),
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
          publishAgentMessage(this.env, targetJob, message, commandId, pubkey),
      );
    }
    this.storage.sql.exec(
      `UPDATE jobs SET job_json = ?, status = ?, available_at = ?,
       lease_token = NULL, lease_expires_at = NULL, updated_at = ?
       WHERE job_id = ?`,
      JSON.stringify(job),
      job.status,
      job.availableAt,
      now,
      job.id,
    );
    if (job.status === "pending" && Date.parse(job.availableAt) <= Date.now()) {
      this.broadcastAvailable(job, now);
    } else {
      await this.scheduleNextAlarm();
    }
    return json({ job, outcome: input.outcome });
  }

  async renew(request: Request, context: TrustedContext) {
    requireAgentPrincipal(context.principal);
    const input = renewAgentJobSchema.parse(await parseJson(request));
    const row = firstAgentRow<{ job_json: string }>(
      this.storage.sql.exec(
        "SELECT job_json FROM jobs WHERE lease_token = ? AND status = 'leased'",
        input.leaseToken,
      ),
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
    this.storage.sql.exec(
      "UPDATE jobs SET lease_expires_at = ? WHERE job_id = ? AND lease_token = ?",
      leaseExpiresAt,
      job.id,
      input.leaseToken,
    );
    await this.scheduleNextAlarm();
    return json({ leaseExpiresAt });
  }

  list(context: TrustedContext) {
    return json(listAgentJobs(this.storage, context.principal));
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
      this.storage.sql.exec(
        `SELECT MIN(next_at) AS next_at FROM (
           SELECT available_at AS next_at FROM jobs WHERE status = 'pending'
           UNION ALL
           SELECT lease_expires_at AS next_at FROM jobs
             WHERE status = 'leased' AND lease_expires_at IS NOT NULL
         )`,
      ),
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
      this.storage.sql.exec(
        "SELECT status FROM jobs WHERE job_id = ?",
        priorJob.id,
      ),
    );
    if (
      repairTerminal &&
      priorJob.kind === "workspace.onboarding" &&
      (stored?.status === "failed" || stored?.status === "completed")
    ) {
      const repaired = agentJobSchema.parse({
        ...refreshed,
        status: "pending",
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
      this.storage.sql.exec(
        reset
          ? `UPDATE jobs SET job_json = ?, status = 'pending', available_at = ?,
             lease_token = NULL, lease_expires_at = NULL, updated_at = ? WHERE job_id = ?`
          : "UPDATE jobs SET job_json = ?, available_at = ?, updated_at = ? WHERE job_id = ?",
        JSON.stringify(job),
        job.availableAt,
        job.updatedAt,
        job.id,
      );
      this.storage.sql.exec(
        "UPDATE receipts SET job_json = ? WHERE command_id = ?",
        JSON.stringify(job),
        commandId,
      );
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
