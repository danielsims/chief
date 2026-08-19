import { DurableObject } from "cloudflare:workers";

import type {
  AgentPrincipal,
  UserPrincipal,
  WorkspaceId,
} from "@chief/relay-contracts";
import {
  agentJobCompletionResultSchema,
  agentJobSchema,
  appendMessageCommandSchema,
  claimAgentJobSchema,
  completeAgentJobSchema,
  enqueueAgentJobCommandSchema,
  workspaceOnboardingResultSchema,
} from "@chief/relay-contracts";

import { HttpError, json, parseJson, relayError } from "./http";
import {
  readTrustedContext,
  withTrustedContext,
  withTrustedIdentity,
} from "./internal-context";

export class AgentObject extends DurableObject<Env> {
  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    void state.blockConcurrencyWhile(() => {
      initialize(state.storage);
      return Promise.resolve();
    });
  }

  async fetch(request: Request) {
    try {
      const context = readTrustedContext(request);
      const path = new URL(request.url).pathname;
      if (request.method === "POST" && path.endsWith("/enqueue")) {
        return await this.enqueue(request, context.workspaceId);
      }
      if (request.method === "POST" && path.endsWith("/claim")) {
        return await this.claim(request);
      }
      if (request.method === "POST" && path.endsWith("/complete")) {
        return await this.complete(request, context);
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
    return json({ duplicate: false, job });
  }

  private async claim(request: Request) {
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
    if (!candidate) return new Response(null, { status: 204 });

    const leaseToken = crypto.randomUUID();
    const leaseExpiresAt = new Date(
      now.getTime() + input.leaseSeconds * 1_000,
    ).toISOString();
    const previous = agentJobSchema.parse(JSON.parse(candidate.job_json));
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
    return json({ job, leaseToken });
  }

  private async complete(
    request: Request,
    context: ReturnType<typeof readTrustedContext>,
  ) {
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
    if (jobCompleted && result?.publishedMessage) {
      await this.publishMessage(
        job,
        result.publishedMessage,
        crypto.randomUUID(),
      );
    }
    if (
      jobCompleted &&
      job.kind === "workspace.onboarding" &&
      context.principal.kind === "user"
    ) {
      await this.publishOnboardingResult(
        job,
        context.principal,
        result as unknown as Record<string, unknown>,
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
    return json({ job, outcome: input.outcome });
  }

  private async publishMessage(
    job: ReturnType<typeof agentJobSchema.parse>,
    message: {
      conversationId: string;
      body: string;
      components?: Array<{
        id: string;
        kind: string;
        version: number;
        payload: Record<string, unknown>;
      }>;
    },
    commandId: string,
  ) {
    const agent: AgentPrincipal = {
      kind: "agent",
      agentId: job.agentId,
      workspaceId: job.workspaceId,
    };
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

  private async publishOnboardingResult(
    job: ReturnType<typeof agentJobSchema.parse>,
    owner: UserPrincipal,
    rawResult: Record<string, unknown>,
  ) {
    const result = workspaceOnboardingResultSchema.parse(rawResult);
    if (result.publishedMessage) {
      await this.publishMessage(
        job,
        result.publishedMessage,
        crypto.randomUUID(),
      );
    } else {
      await this.publishMessage(
        job,
        {
          conversationId: "mission-control",
          body: result.openingMessage,
        },
        crypto.randomUUID(),
      );
    }
    const workspace = this.env.WORKSPACES.get(
      this.env.WORKSPACES.idFromName(job.workspaceId),
    );
    const snapshotResponse = await workspace.fetch(
      withTrustedIdentity(
        {
          identity: { kind: "user", userId: owner.userId },
          requestId: job.id,
          workspaceId: job.workspaceId,
        },
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-chief-internal-operation": "complete-onboarding",
          },
          body: JSON.stringify(result),
        },
      ),
    );
    if (!snapshotResponse.ok) {
      throw new HttpError(
        502,
        "onboarding_snapshot_failed",
        "Chief's workspace setup could not be finalized.",
      );
    }
    await this.enqueueKickoff(job, owner, result);
  }

  /**
   * Mirrors the desktop bootstrap: after onboarding completes, queue a small
   * amount of real follow-up work the mobile (or a future cloud) executor can
   * claim and run. These jobs carry derived payloads (company, apps) so the
   * next turn has genuine context instead of fabricated activity.
   */
  private async enqueueKickoff(
    job: ReturnType<typeof agentJobSchema.parse>,
    owner: UserPrincipal,
    result: ReturnType<typeof workspaceOnboardingResultSchema.parse>,
  ) {
    const payload = (job.payload ?? {}) as Record<string, unknown>;
    const name = String(payload.name ?? "this workspace");
    const website = String(payload.website ?? "");
    const selectedApps = Array.isArray(payload.selectedApps)
      ? (payload.selectedApps as unknown[]).map(String)
      : [];
    const now = new Date();
    const activateAt = new Date(now.getTime() + 3_000).toISOString();
    const jobsToEnqueue: Array<{
      agentId: string;
      kind: string;
      jobPayload: Record<string, unknown>;
      availableAt: string;
    }> = [
      {
        agentId: "chief",
        kind: "workspace.activate",
        jobPayload: {
          name,
          website,
          selectedApps,
          instruction:
            "Welcome the owner to their new workspace. Confirm what is set up, name the first useful thing you'll inspect given the selected apps, and note that specialists will join as useful work is identified. Support the opening message, do not repeat it.",
        },
        availableAt: activateAt,
      },
    ];
    for (const entry of jobsToEnqueue) {
      const jobId = crypto.randomUUID();
      const command = {
        commandId: crypto.randomUUID(),
        protocolVersion: 1,
        occurredAt: new Date().toISOString(),
        payload: {
          id: jobId,
          agentId: entry.agentId,
          kind: entry.kind,
          payload: entry.jobPayload,
          availableAt: entry.availableAt,
        },
      };
      const stub = this.env.AGENTS.get(
        this.env.AGENTS.idFromName(`${job.workspaceId}:${entry.agentId}`),
      );
      const response = await stub.fetch(
        withTrustedContext(
          new Request("https://agent.internal/enqueue", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(command),
          }),
          {
            principal: owner,
            requestId: job.id,
            workspaceId: job.workspaceId,
          },
        ),
      );
      if (!response.ok) {
        throw new HttpError(
          502,
          "kickoff_enqueue_failed",
          "Chief's follow-up work could not be queued.",
        );
      }
    }
  }
}

function initialize(storage: DurableObjectStorage) {
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
  `);
}

function firstRow<T>(cursor: Iterable<T>): T | undefined {
  return cursor[Symbol.iterator]().next().value as T | undefined;
}
