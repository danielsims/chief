import { DurableObject } from "cloudflare:workers";

import type { AgentPrincipal, WorkspaceId } from "@chief/relay-contracts";
import {
  agentJobCompletionResultSchema,
  agentJobSchema,
  appendMessageCommandSchema,
  claimAgentJobSchema,
  completeAgentJobSchema,
  enqueueAgentJobCommandSchema,
  principalSchema,
  socketTicketSchema,
} from "@chief/relay-contracts";

import {
  actorPubkey,
  firstAgentRow as firstRow,
  initializeAgentJobs,
  requireAgentOwnsJob,
  requireAgentPrincipal,
} from "./agent-job-store";
import { validateSpecialistKickoff } from "./agent-kickoff-verification";
import { publishOnboardingResult } from "./agent-onboarding";
import { HttpError, json, parseJson, relayError } from "./http";
import {
  readTrustedAgentSocketTicket,
  readTrustedContext,
  withTrustedContext,
} from "./internal-context";
import {
  consumeSocketTicket,
  createSocketTicket,
  initializeSocketTickets,
} from "./socket-ticket-store";

export class AgentObject extends DurableObject<Env> {
  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    void state.blockConcurrencyWhile(() => {
      initializeAgentJobs(state.storage);
      initializeSocketTickets(state.storage);
      return Promise.resolve();
    });
  }

  async fetch(request: Request) {
    try {
      if (request.headers.get("upgrade") === "websocket") {
        return await this.connectWebSocket(request);
      }
      const context = readTrustedContext(request);
      const path = new URL(request.url).pathname;
      if (request.method === "POST" && path.endsWith("/enqueue")) {
        return await this.enqueue(request, context.workspaceId);
      }
      if (request.method === "POST" && path.endsWith("/claim")) {
        return await this.claim(request, context);
      }
      if (request.method === "POST" && path.endsWith("/complete")) {
        return await this.complete(request, context);
      }
      if (request.method === "POST" && path.endsWith("/socket-tickets")) {
        return await this.createMailboxSocketTicket(request, context);
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

  private async enqueue(request: Request, workspaceId: WorkspaceId) {
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
      return json({
        duplicate: true,
        job: agentJobSchema.parse(JSON.parse(prior.job_json) as unknown),
      });
    }

    const now = command.occurredAt;
    const job = agentJobSchema.parse({
      ...command.payload,
      workspaceId,
      status: "pending",
      attempt: 0,
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
    } else {
      await this.scheduleNextAlarm();
    }
    return json({ duplicate: false, job });
  }

  /// Wakes sockets for scheduled work and expired leases. A socket event is a
  /// hint only; the authenticated agent still has to claim its durable row.
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
      this.broadcastAvailable(
        agentJobSchema.parse(JSON.parse(due.job_json)),
        now,
      );
      return;
    }
    await this.scheduleNextAlarm();
  }

  private async createMailboxSocketTicket(
    request: Request,
    context: ReturnType<typeof readTrustedContext>,
  ) {
    requireAgentPrincipal(context.principal);
    const agentId = new URL(request.url).searchParams.get("agentId");
    if (agentId !== context.principal.agentId) {
      throw new HttpError(
        403,
        "agent_mailbox_access_denied",
        "An agent can only subscribe to its own mailbox.",
      );
    }
    return json(
      socketTicketSchema.parse(
        await createSocketTicket(this.ctx.storage, context.principal),
      ),
      { status: 201 },
    );
  }

  private async connectWebSocket(request: Request) {
    const context = readTrustedAgentSocketTicket(request);
    const principalJson = await consumeSocketTicket(
      this.ctx.storage,
      context.ticket,
    );
    if (!principalJson) {
      return relayError(
        401,
        "invalid_socket_ticket",
        "The socket ticket is invalid or expired.",
      );
    }
    const principal = principalSchema.parse(JSON.parse(principalJson));
    if (principal.kind !== "agent" || principal.agentId !== context.agentId) {
      return relayError(
        403,
        "agent_mailbox_access_denied",
        "The socket ticket does not belong to this agent.",
      );
    }
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.ctx.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  private broadcast(event: Record<string, unknown>) {
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
    if (Number.isFinite(next) && next > Date.now()) {
      await this.ctx.storage.setAlarm(next);
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
      await this.publishMessage(
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
        result as unknown as Record<string, unknown>,
        (targetJob, message, commandId, pubkey) =>
          this.publishMessage(targetJob, message, commandId, pubkey),
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

  private async publishMessage(
    job: ReturnType<typeof agentJobSchema.parse>,
    message: {
      conversationId: string;
      body: string;
      components?: {
        id: string;
        kind: string;
        version: number;
        payload: Record<string, unknown>;
      }[];
    },
    commandId: string,
    actorPubkey?: string,
  ) {
    const agent: AgentPrincipal = {
      kind: "agent",
      agentId: job.agentId,
      pubkey: (job.agentPubkey ?? actorPubkey)?.toLowerCase() ?? "0".repeat(64),
      workspaceId: job.workspaceId,
    };
    const workspace = this.env.WORKSPACES.get(
      this.env.WORKSPACES.idFromName(job.workspaceId),
    );
    const authorization = await workspace.fetch(
      withTrustedContext(
        new Request(
          `https://workspace.internal?conversationId=${encodeURIComponent(message.conversationId)}`,
          {
            method: "POST",
            headers: {
              "x-chief-internal-operation": "authorize-conversation",
            },
          },
        ),
        {
          principal: agent,
          requestId: commandId,
          workspaceId: job.workspaceId,
          conversationId: message.conversationId,
        },
      ),
    );
    if (!authorization.ok) {
      throw new HttpError(
        authorization.status,
        "job_conversation_denied",
        "The agent cannot publish to that conversation.",
      );
    }
    const command = appendMessageCommandSchema.parse({
      commandId,
      protocolVersion: 1,
      occurredAt: new Date().toISOString(),
      payload: {
        messageId: crypto.randomUUID(),
        conversationId: message.conversationId,
        body: message.body,
        components: message.components ?? [],
      },
    });
    const conversation = this.env.CONVERSATIONS.get(
      this.env.CONVERSATIONS.idFromName(
        `${job.workspaceId}:${message.conversationId}`,
      ),
    );
    const response = await conversation.fetch(
      withTrustedContext(
        new Request("https://conversation.internal/messages", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(command),
        }),
        {
          principal: agent,
          requestId: commandId,
          workspaceId: job.workspaceId,
          conversationId: message.conversationId,
        },
      ),
    );
    if (!response.ok) {
      throw new HttpError(
        502,
        "job_message_failed",
        "The agent's message could not be delivered.",
      );
    }
  }
}
