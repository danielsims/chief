import { DurableObject } from "cloudflare:workers";

import type {
  AgentPrincipal,
  JsonObject,
  JsonValue,
  WorkspaceId,
} from "@chief/relay-contracts";
import {
  agentCellSnapshotSchema,
  agentIdSchema,
  agentJobCompletionResultSchema,
  agentJobSchema,
  claimAgentJobSchema,
  completeAgentJobSchema,
  enqueueAgentJobCommandSchema,
  isJsonString,
  parseJsonObject,
  parseJsonValue,
  renewAgentJobSchema,
} from "@chief/relay-contracts";

import { listAgentJobs, retryAgentJob } from "./agent-job-administration";
import {
  actorPubkey,
  firstAgentRow as firstRow,
  initializeAgentJobs,
  requireAgentOwnsJob,
  requireAgentPrincipal,
} from "./agent-job-store";
import { validateSpecialistKickoff } from "./agent-kickoff-verification";
import {
  connectAgentMailboxWebSocket,
  createAgentMailboxSocketTicket,
} from "./agent-mailbox";
import { publishAgentMessage } from "./agent-message-publisher";
import { publishOnboardingResult } from "./agent-onboarding";
import {
  loadAgentHostingContext,
  runHostedAgentJob,
} from "./hosted-agent-runner";
import { HttpError, json, parseJson, relayError } from "./http";
import { readTrustedContext } from "./internal-context";
import { initializeSocketTickets } from "./socket-ticket-store";

export class AgentObject extends DurableObject<Env> {
  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    void state.blockConcurrencyWhile(async () => {
      initializeAgentJobs(state.storage);
      initializeSocketTickets(state.storage);
      if (env.HOSTED_CELL_ENABLED === "true") {
        await this.scheduleNextAlarm();
      }
    });
  }

  async fetch(request: Request) {
    try {
      if (request.headers.get("x-chief-internal-operation") === "delete-all") {
        readTrustedContext(request);
        await this.ctx.storage.deleteAll();
        return new Response(null, { status: 204 });
      }
      if (request.headers.get("upgrade") === "websocket") {
        return await connectAgentMailboxWebSocket(this.ctx, request);
      }
      const context = readTrustedContext(request);
      const path = new URL(request.url).pathname;
      if (request.method === "POST" && path.endsWith("/enqueue")) {
        return await this.enqueue(request, context.workspaceId);
      }
      if (request.method === "POST" && path.endsWith("/ensure")) {
        return await this.enqueue(request, context.workspaceId, true);
      }
      if (request.method === "POST" && path.endsWith("/claim")) {
        return await this.claim(request, context);
      }
      if (request.method === "POST" && path.endsWith("/complete")) {
        return await this.complete(request, context);
      }
      if (request.method === "POST" && path.endsWith("/renew")) {
        return await this.renew(request, context);
      }
      if (request.method === "GET" && path.endsWith("/jobs")) {
        return this.listJobs(context);
      }
      if (request.method === "POST" && path.endsWith("/retry")) {
        return this.retryJob(request, context);
      }
      if (request.method === "POST" && path.endsWith("/socket-tickets")) {
        return await createAgentMailboxSocketTicket(
          this.ctx.storage,
          request,
          context,
        );
      }
      if (
        (request.method === "GET" || request.method === "PUT") &&
        path.endsWith("/snapshot")
      ) {
        return await this.cellSnapshot(request, context);
      }
      return relayError(404, "not_found", "Agent operation not found.");
    } catch (error) {
      if (error instanceof HttpError) {
        return relayError(error.status, error.code, error.message);
      }
      return relayError(
        400,
        "invalid_request",
        "The agent request is invalid.",
      );
    }
  }

  private async enqueue(
    request: Request,
    workspaceId: WorkspaceId,
    repairTerminal = false,
  ) {
    const command = enqueueAgentJobCommandSchema.parse(
      await parseJson(request),
    );
    const prior = firstRow<{ job_json: string }>(
      this.ctx.storage.sql.exec(
        "SELECT job_json FROM receipts WHERE command_id = ?",
        command.commandId,
      ),
    );
    if (prior) {
      const priorJob = agentJobSchema.parse(JSON.parse(prior.job_json));
      const now = new Date().toISOString();
      const refreshedJob = agentJobSchema.parse({
        ...priorJob,
        payload: {
          ...priorJob.payload,
          ...command.payload.payload,
        },
        updatedAt: now,
      });
      const stored = firstRow<{ status: string }>(
        this.ctx.storage.sql.exec(
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
          ...refreshedJob,
          status: "pending",
          lastError: null,
          availableAt: now,
          leaseExpiresAt: null,
          updatedAt: now,
        });
        this.ctx.storage.transactionSync(() => {
          this.ctx.storage.sql.exec(
            `UPDATE jobs SET job_json = ?, status = 'pending', available_at = ?,
             lease_token = NULL, lease_expires_at = NULL, updated_at = ?
             WHERE job_id = ?`,
            JSON.stringify(repaired),
            now,
            now,
            repaired.id,
          );
          this.ctx.storage.sql.exec(
            "UPDATE receipts SET job_json = ? WHERE command_id = ?",
            JSON.stringify(repaired),
            command.commandId,
          );
        });
        this.broadcastAvailable(repaired, now);
        await this.scheduleHostedAlarm(repaired);
        return json({ duplicate: false, repaired: true, job: repaired });
      }
      if (repairTerminal && stored?.status === "pending") {
        this.ctx.storage.transactionSync(() => {
          this.ctx.storage.sql.exec(
            "UPDATE jobs SET job_json = ?, updated_at = ? WHERE job_id = ?",
            JSON.stringify(refreshedJob),
            now,
            refreshedJob.id,
          );
          this.ctx.storage.sql.exec(
            "UPDATE receipts SET job_json = ? WHERE command_id = ?",
            JSON.stringify(refreshedJob),
            command.commandId,
          );
        });
        if (Date.parse(refreshedJob.availableAt) <= Date.now()) {
          this.broadcastAvailable(refreshedJob, now);
        }
        await this.scheduleHostedAlarm(refreshedJob);
        return json({ duplicate: true, refreshed: true, job: refreshedJob });
      }
      return json({
        duplicate: true,
        job: priorJob,
      });
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
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        `INSERT INTO jobs (
          job_id, job_json, status, available_at, lease_token, lease_expires_at,
          updated_at
        ) VALUES (?, ?, 'pending', ?, NULL, NULL, ?)`,
        job.id,
        JSON.stringify(job),
        job.availableAt,
        now,
      );
      this.ctx.storage.sql.exec(
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

  /// Wakes signed celld sockets first. Cloud workspaces then use the same
  /// atomic lease for a native Durable Object + Workers AI execution, so an
  /// open phone/desktop cell and the hosted cell can safely coexist.
  async alarm() {
    const now = new Date().toISOString();
    const due = firstRow<{ job_json: string }>(
      this.ctx.storage.sql.exec(
        `SELECT job_json FROM jobs
         WHERE (status = 'pending' AND available_at <= ?)
            OR (status = 'leased' AND lease_expires_at <= ?)
         ORDER BY available_at ASC, rowid ASC LIMIT 1`,
        now,
        now,
      ),
    );
    if (due) {
      const job = agentJobSchema.parse(JSON.parse(due.job_json));
      this.broadcastAvailable(job, now);
      if (this.env.HOSTED_CELL_ENABLED !== "true") return;
      const principal = hostedPrincipal(job);
      const hosting = await loadAgentHostingContext(this.env, job, principal);
      if (hosting?.runtime !== "cloud" || hosting.config?.enabled === false) {
        return;
      }
      const claimResponse = await this.claim(
        new Request("https://agent.internal/claim", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            workerId: "cloudflare-hosted-cell",
            leaseSeconds: 300,
          }),
        }),
        {
          principal,
          requestId: crypto.randomUUID(),
          workspaceId: job.workspaceId,
          conversationId: null,
        },
      );
      if (claimResponse.status === 204) return;
      const lease: {
        job: ReturnType<typeof agentJobSchema.parse>;
        leaseToken: string;
      } = await claimResponse.json();
      try {
        const result = await runHostedAgentJob(
          this.env,
          lease.job,
          principal,
          hosting,
        );
        this.recordHostedCellState(lease.job, result, hosting.agent);
        await this.completeHosted(lease.leaseToken, principal, {
          status: "completed",
          result,
        });
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Hosted cell execution failed.";
        const retryAt = new Date(
          Date.now() +
            Math.min(15 * 60_000, 30_000 * 2 ** Math.min(lease.job.attempt, 5)),
        ).toISOString();
        console.error("Hosted cell execution failed", {
          workspaceId: lease.job.workspaceId,
          agentId: lease.job.agentId,
          jobId: lease.job.id,
          error: message,
          retryAt,
        });
        await this.completeHosted(lease.leaseToken, principal, {
          status: "failed",
          error: message.slice(0, 4_000),
          retryAt,
        });
      }
      return;
    }
    await this.scheduleNextAlarm();
  }

  private broadcast(event: JsonObject) {
    const serialized = JSON.stringify(event);
    for (const socket of this.ctx.getWebSockets()) {
      try {
        socket.send(serialized);
      } catch {
        socket.close(1011, "Delivery failed");
      }
    }
  }

  private broadcastAvailable(
    job: ReturnType<typeof agentJobSchema.parse>,
    occurredAt: string,
  ) {
    this.broadcast({
      type: "agent.job.available",
      occurredAt,
      payload: { agentId: job.agentId, jobId: job.id, kind: job.kind },
    });
  }

  private async scheduleNextAlarm() {
    const row = firstRow<{ next_at: string | null }>(
      this.ctx.storage.sql.exec(
        `SELECT MIN(next_at) AS next_at FROM (
           SELECT available_at AS next_at FROM jobs WHERE status = 'pending'
           UNION ALL
           SELECT lease_expires_at AS next_at FROM jobs
             WHERE status = 'leased' AND lease_expires_at IS NOT NULL
         )`,
      ),
    );
    if (!row?.next_at) {
      await this.ctx.storage.deleteAlarm();
      return;
    }
    const next = Date.parse(row.next_at);
    if (Number.isFinite(next)) {
      await this.ctx.storage.setAlarm(Math.max(next, Date.now() + 50));
    }
  }

  private async scheduleHostedAlarm(
    job: ReturnType<typeof agentJobSchema.parse>,
  ) {
    if (this.env.HOSTED_CELL_ENABLED !== "true") return;
    const availableAt = Date.parse(job.availableAt);
    const deviceGraceAt = Date.now() + 2_000;
    await this.ctx.storage.setAlarm(
      Math.max(
        Number.isFinite(availableAt) ? availableAt : Date.now(),
        deviceGraceAt,
      ),
    );
  }

  private async completeHosted(
    leaseToken: string,
    principal: AgentPrincipal,
    outcome:
      | { status: "completed"; result: unknown }
      | { status: "failed"; error: string; retryAt: string },
  ) {
    const response = await this.complete(
      new Request("https://agent.internal/complete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ leaseToken, outcome }),
      }),
      {
        principal,
        requestId: crypto.randomUUID(),
        workspaceId: principal.workspaceId,
        conversationId: null,
      },
    );
    if (!response.ok) {
      throw new Error(`Hosted cell completion failed (${response.status}).`);
    }
  }

  webSocketMessage(socket: WebSocket, message: string | ArrayBuffer) {
    if (message === "ping") socket.send("pong");
  }

  private async claim(
    request: Request,
    context: ReturnType<typeof readTrustedContext>,
  ) {
    requireAgentPrincipal(context.principal);
    const input = claimAgentJobSchema.parse(await parseJson(request));
    const now = new Date();
    const candidate = firstRow<{ job_id: string; job_json: string }>(
      this.ctx.storage.sql.exec(
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
    this.ctx.storage.sql.exec(
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

  private async complete(
    request: Request,
    context: ReturnType<typeof readTrustedContext>,
  ) {
    requireAgentPrincipal(context.principal);
    const input = completeAgentJobSchema.parse(await parseJson(request));
    const row = firstRow<{ job_id: string; job_json: string }>(
      this.ctx.storage.sql.exec(
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
    const status = retryAt ? "pending" : input.outcome.status;
    const job = agentJobSchema.parse({
      ...previous,
      status,
      lastError: input.outcome.status === "failed" ? input.outcome.error : null,
      availableAt: retryAt ?? previous.availableAt,
      leaseExpiresAt: null,
      updatedAt: now,
    });
    const jobCompleted =
      job.status === "completed" && input.outcome.status === "completed";
    const result =
      jobCompleted && input.outcome.status === "completed"
        ? agentJobCompletionResultSchema.parse(input.outcome.result)
        : null;
    if (
      jobCompleted &&
      job.kind !== "workspace.onboarding" &&
      result?.publishedMessage
    ) {
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
    if (jobCompleted && job.kind === "workspace.onboarding") {
      await publishOnboardingResult(
        this.env,
        job,
        context.principal,
        parseJsonObject(result) ?? {},
        (targetJob, message, commandId, pubkey) =>
          publishAgentMessage(this.env, targetJob, message, commandId, pubkey),
      );
    }
    this.ctx.storage.sql.exec(
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

  private async renew(
    request: Request,
    context: ReturnType<typeof readTrustedContext>,
  ) {
    requireAgentPrincipal(context.principal);
    const input = renewAgentJobSchema.parse(await parseJson(request));
    const row = firstRow<{ job_json: string }>(
      this.ctx.storage.sql.exec(
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
    this.ctx.storage.sql.exec(
      "UPDATE jobs SET lease_expires_at = ? WHERE job_id = ? AND lease_token = ?",
      leaseExpiresAt,
      job.id,
      input.leaseToken,
    );
    await this.scheduleNextAlarm();
    return json({ leaseExpiresAt });
  }

  private async cellSnapshot(
    request: Request,
    context: ReturnType<typeof readTrustedContext>,
  ) {
    const agentId = agentIdSchema.parse(
      new URL(request.url).searchParams.get("agentId"),
    );
    const canTransfer =
      (context.principal.kind === "agent" &&
        context.principal.agentId === agentId) ||
      (context.principal.kind === "user" &&
        (context.principal.role === "owner" ||
          context.principal.role === "admin"));
    if (!canTransfer) {
      throw new HttpError(
        403,
        "cell_snapshot_denied",
        "Only this agent or a workspace owner can transfer its cell state.",
      );
    }
    const cellId = `${context.workspaceId}:${agentId}`;
    if (request.method === "GET") {
      const rows = this.ctx.storage.sql
        .exec<{ key: string; value_json: string }>(
          "SELECT key, value_json FROM cell_records ORDER BY key LIMIT 1000",
        )
        .toArray();
      return json(
        agentCellSnapshotSchema.parse({
          version: 1,
          cellId,
          workspaceId: context.workspaceId,
          agentId,
          exportedAt: new Date().toISOString(),
          records: rows.map((row) => ({
            key: String(row.key),
            value: parseStoredJson(row.value_json),
          })),
        }),
      );
    }
    const snapshot = agentCellSnapshotSchema.parse(await parseJson(request));
    if (
      snapshot.cellId !== cellId ||
      snapshot.workspaceId !== context.workspaceId ||
      snapshot.agentId !== agentId
    ) {
      throw new HttpError(
        409,
        "cell_snapshot_scope_mismatch",
        "The cell snapshot belongs to another workspace or agent.",
      );
    }
    const updatedAt = new Date().toISOString();
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec("DELETE FROM cell_records");
      for (const record of snapshot.records) {
        this.putCellRecord(record.key, record.value, updatedAt);
      }
    });
    return json({ ok: true, imported: snapshot.records.length });
  }

  private recordHostedCellState(
    job: ReturnType<typeof agentJobSchema.parse>,
    result: ReturnType<typeof agentJobCompletionResultSchema.parse>,
    agent?: { id: string; name: string; role: string },
  ) {
    const conversationId = isJsonString(job.payload.conversationId)
      ? job.payload.conversationId
      : "mission-control";
    const key = `conversation:${conversationId}:messages`;
    const row = firstRow<{ value_json: string }>(
      this.ctx.storage.sql.exec(
        "SELECT value_json FROM cell_records WHERE key = ?",
        key,
      ),
    );
    const messages = row ? safeArray(row.value_json) : [];
    const at = Date.now();
    const instruction = isJsonString(job.payload.instruction)
      ? job.payload.instruction
      : job.kind;
    const answer =
      result.publishedMessage?.body ?? result.openingMessage ?? "Completed.";
    messages.push({ role: "user", content: instruction, at, conversationId });
    messages.push({
      role: "assistant",
      content: answer,
      at: at + 1,
      conversationId,
    });
    const now = new Date().toISOString();
    const journalRow = firstRow<{ value_json: string }>(
      this.ctx.storage.sql.exec(
        "SELECT value_json FROM cell_records WHERE key = 'agent:work-journal'",
      ),
    );
    const journal = journalRow ? safeArray(journalRow.value_json) : [];
    journal.push({
      conversationId,
      user: instruction.slice(0, 1_000),
      assistant: answer.slice(0, 2_000),
      completedAt: now,
    });
    this.ctx.storage.transactionSync(() => {
      this.putCellRecord(key, messages.slice(-200), now);
      this.putCellRecord("agent:work-journal", journal.slice(-120), now);
      this.putCellRecord(
        "eve:package:manifest",
        {
          protocolVersion: 1,
          runtime: "chief-cloudflare-cell",
          agentId: job.agentId,
          scope: `${job.workspaceId}:${job.agentId}`,
        },
        now,
      );
      if (agent) {
        this.putCellRecord(
          "eve:package:instructions",
          `You are ${agent.name}, the workspace's ${agent.role} agent.`,
          now,
        );
      }
    });
  }

  private putCellRecord(key: string, value: JsonValue, updatedAt: string) {
    this.ctx.storage.sql.exec(
      `INSERT INTO cell_records (key, value_json, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json,
         updated_at = excluded.updated_at`,
      key,
      JSON.stringify(value),
      updatedAt,
    );
  }

  private listJobs(context: ReturnType<typeof readTrustedContext>) {
    return json(listAgentJobs(this.ctx.storage, context.principal));
  }

  private retryJob(
    request: Request,
    context: ReturnType<typeof readTrustedContext>,
  ) {
    const segments = new URL(request.url).pathname.split("/").filter(Boolean);
    const retryIndex = segments.lastIndexOf("retry");
    const job = retryAgentJob(
      this.ctx.storage,
      context.principal,
      segments[retryIndex - 1] ?? "",
    );
    const now = job.updatedAt;
    this.broadcastAvailable(job, now);
    return json({ job });
  }
}

function hostedPrincipal(
  job: ReturnType<typeof agentJobSchema.parse>,
): AgentPrincipal {
  return {
    kind: "agent",
    agentId: job.agentId,
    pubkey: job.agentPubkey?.toLowerCase() ?? "0".repeat(64),
    workspaceId: job.workspaceId,
    role: "member",
  };
}

function parseStoredJson(value: string): JsonValue {
  try {
    const parsed: unknown = JSON.parse(value);
    return parseJsonValue(parsed) ?? null;
  } catch {
    return null;
  }
}

function safeArray(value: string): JsonValue[] {
  const parsed = parseStoredJson(value);
  return Array.isArray(parsed) ? parsed : [];
}
