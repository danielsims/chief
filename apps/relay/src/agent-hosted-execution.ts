import { z } from "zod";

import type {
  AgentConfig,
  AgentPrincipal,
  JsonObject,
} from "@chief/relay-contracts";
import { DurableTurnRunner } from "@chief/agent-runtime/durable-turn";
import { agentJobSchema, isJsonString } from "@chief/relay-contracts";

import type { AgentJobQueue } from "./agent-job-queue";
import type { CloudflareAgentBrowser } from "./cloudflare-agent-browser";
import type { CloudflareAgentComputer } from "./cloudflare-agent-computer";
import { publishAgentErrorActivity } from "./agent-activity";
import { recordCompletedTurn } from "./agent-cell-projection";
import { agentCellPersistence } from "./agent-cell-storage";
import { hostedActivityObserver } from "./agent-hosted-activity";
import { firstAgentRow } from "./agent-job-store";
import { hostedPrincipal } from "./agent-object-values";
import {
  traceAgentRun,
  tracedInference,
  traceToolExecution,
} from "./agent-tracing";
import {
  hostedTurnResult,
  loadAgentHostingContext,
  prepareHostedAgentTurn,
} from "./hosted-agent-runner";
import {
  executeHostedAgentTool,
  hostedDurableTools,
} from "./hosted-agent-tools";
import { withTrustedContext } from "./internal-context";
import { createOpenCodeAgentInference } from "./opencode-agent-inference";

type AgentJob = ReturnType<typeof agentJobSchema.parse>;

const hostedLeaseSchema = z.object({
  job: agentJobSchema,
  leaseToken: z.string(),
});
const secretValueSchema = z.object({ value: z.string().optional() });

export class AgentHostedExecution {
  private readonly turns: DurableTurnRunner;

  constructor(
    private readonly storage: DurableObjectStorage,
    private readonly env: Env,
    private readonly computer: CloudflareAgentComputer,
    private readonly browser: CloudflareAgentBrowser,
    private readonly queue: AgentJobQueue,
    private readonly broadcast: (event: JsonObject) => void,
  ) {
    this.turns = new DurableTurnRunner(agentCellPersistence(storage), "agent", {
      compactionRatio: compactionRatio(env.HOSTED_AGENT_COMPACTION_RATIO),
    });
  }

  async runDueJob() {
    const active = await this.turns.active();
    if (active) {
      await this.continueTurn(active.jobId);
      return;
    }
    await this.admitDueJob();
  }

  async scheduleNextAlarm() {
    const turnWake = await this.turns.nextWakeAt();
    if (turnWake !== undefined) {
      await this.storage.setAlarm(turnWake);
      return;
    }
    await this.queue.scheduleNextAlarm();
  }

  private async admitDueJob() {
    const now = new Date().toISOString();
    const due = firstAgentRow<{ job_json: string }>(
      this.storage.sql.exec(
        `SELECT job_json FROM jobs
         WHERE (status = 'pending' AND available_at <= ?)
            OR (status = 'leased' AND lease_expires_at <= ?)
         ORDER BY available_at ASC, rowid ASC LIMIT 1`,
        now,
        now,
      ),
    );
    if (!due) {
      await this.queue.scheduleNextAlarm();
      return;
    }
    const job = agentJobSchema.parse(JSON.parse(due.job_json));
    this.broadcast({
      type: "agent.job.available",
      occurredAt: now,
      payload: { agentId: job.agentId, jobId: job.id, kind: job.kind },
    });
    if (this.env.HOSTED_CELL_ENABLED !== "true") return;
    const principal = hostedPrincipal(job);
    const hosting = await loadAgentHostingContext(this.env, job, principal);
    if (hosting?.runtime !== "cloud" || hosting.config?.enabled === false) {
      return;
    }
    if (!hosting.config) {
      throw new Error("The hosted agent configuration is unavailable.");
    }
    const response = await this.queue.claim(
      claimRequest(),
      trustedContext(principal),
    );
    if (response.status === 204) return;
    const lease = await parseLease(response);
    try {
      const prepared = await prepareHostedAgentTurn(
        this.env,
        lease.job,
        principal,
        hosting,
      );
      await this.turns.create({ ...prepared, leaseToken: lease.leaseToken });
      await this.scheduleNextAlarm();
    } catch (error) {
      const failure =
        error instanceof Error
          ? error
          : new Error("Hosted cell execution failed.");
      await this.failAdmission(lease.job, lease.leaseToken, principal, failure);
    }
  }

  private async continueTurn(jobId: string) {
    const turn = await this.turns.active();
    if (!turn || turn.jobId !== jobId) return;
    const job = this.loadJob(jobId);
    if (!job) {
      await this.turns.markSettled();
      await this.scheduleNextAlarm();
      return;
    }
    const principal = hostedPrincipal(job);
    const maintained = this.queue.maintainHostedLease(
      job.id,
      turn.leaseToken,
      principal,
      900,
    );
    if (!maintained) {
      await this.turns.markSettled();
      await this.scheduleNextAlarm();
      return;
    }
    if (maintained.leaseToken !== turn.leaseToken) {
      await this.turns.updateLeaseToken(maintained.leaseToken);
    }
    const current = await this.turns.active();
    if (!current) return;
    if (current.phase.kind !== "runnable") {
      await this.settleTurn(maintained.job, principal);
      return;
    }
    const hosting = await loadAgentHostingContext(
      this.env,
      maintained.job,
      principal,
    );
    if (!hosting?.config || hosting.runtime !== "cloud") {
      await this.failTurn(
        maintained.job,
        principal,
        "The hosted agent configuration is unavailable.",
      );
      return;
    }
    try {
      const apiKey = await this.resolveInferenceApiKey(
        maintained.job,
        principal,
        hosting.config,
      );
      const browserEnabled = current.browserEnabled;
      const tools = hostedDurableTools(browserEnabled);
      const traceContext = this.traceContext(maintained.job);
      const result = await traceAgentRun(traceContext, current.revision, () =>
        this.turns.advance({
          inference: tracedInference(
            createOpenCodeAgentInference(apiKey),
            traceContext,
          ),
          tools,
          observer: hostedActivityObserver(this.env, maintained.job, principal),
          scheduleRecovery: async (wakeAt) =>
            await this.storage.setAlarm(wakeAt),
          executor: {
            execute: async (call) =>
              await traceToolExecution(traceContext, call, async () =>
                executeHostedAgentTool(
                  this.computer,
                  browserEnabled ? this.browser : undefined,
                  this.env,
                  maintained.job,
                  principal,
                  call.name,
                  call.arguments,
                ),
              ),
          },
        }),
      );
      if (result.kind === "sleeping") {
        await this.storage.setAlarm(result.wakeAt);
      } else if (result.kind === "terminal") {
        await this.settleTurn(maintained.job, principal);
      } else {
        await this.scheduleNextAlarm();
      }
    } catch (error) {
      const failure =
        error instanceof Error
          ? error
          : new Error("Hosted cell execution failed.");
      await this.deferTurn(maintained.job, principal, failure);
    }
  }

  private async settleTurn(job: AgentJob, principal: AgentPrincipal) {
    const turn = await this.turns.active();
    if (!turn) return;
    if (turn.phase.kind === "completed") {
      const result = hostedTurnResult(job, turn.phase.result);
      const hosting = await loadAgentHostingContext(this.env, job, principal);
      recordCompletedTurn(this.storage, job, result, hosting?.agent);
      await this.complete(turn.leaseToken, principal, {
        status: "completed",
        result,
      });
    } else {
      const error =
        turn.phase.kind === "needs_attention"
          ? turn.phase.message
          : turn.phase.kind === "failed"
            ? turn.phase.error
            : "The hosted turn stopped unexpectedly.";
      await this.complete(turn.leaseToken, principal, {
        status: "failed",
        error,
      });
    }
    await this.turns.markSettled();
    await this.scheduleNextAlarm();
  }

  private async failTurn(
    job: AgentJob,
    principal: AgentPrincipal,
    message: string,
  ) {
    const turn = await this.turns.active();
    if (!turn) return;
    await this.complete(turn.leaseToken, principal, {
      status: "failed",
      error: message,
    });
    await this.turns.markSettled();
    await this.scheduleNextAlarm();
  }

  private async deferTurn(
    job: AgentJob,
    principal: AgentPrincipal,
    error: Error,
  ) {
    const wakeAt = Date.now() + retryDelay(job.attempt);
    await this.turns.deferUntil(wakeAt);
    console.error("Hosted durable turn step failed", {
      workspaceId: job.workspaceId,
      agentId: job.agentId,
      jobId: job.id,
      cause: error.message,
      retryAt: new Date(wakeAt).toISOString(),
    });
    await publishAgentErrorActivity(this.env, {
      principal,
      conversationId: isJsonString(job.payload.conversationId)
        ? job.payload.conversationId
        : "mission-control",
      seed: `${job.id}:hosted-run`,
      code: "agent_run_failed",
      title: "Agent run interrupted",
      message: hostedErrorMessage(error.message),
      jobId: job.id,
      retryable: true,
    }).catch(() => undefined);
    await this.storage.setAlarm(wakeAt);
  }

  private async failAdmission(
    job: AgentJob,
    leaseToken: string,
    principal: AgentPrincipal,
    error: Error,
  ) {
    const retryAt = new Date(
      Date.now() + retryDelay(job.attempt),
    ).toISOString();
    console.error("Hosted cell admission failed", {
      workspaceId: job.workspaceId,
      agentId: job.agentId,
      jobId: job.id,
      cause: error.message,
      retryAt,
    });
    await this.complete(leaseToken, principal, {
      status: "failed",
      error: error.message.slice(0, 4_000),
      retryAt,
    });
  }

  private async resolveInferenceApiKey(
    job: AgentJob,
    principal: AgentPrincipal,
    config: AgentConfig,
  ) {
    const candidates = [config.inference.secretRef, "opencode"].filter(
      (name): name is string => Boolean(name),
    );
    for (const name of candidates) {
      const target = new URL("https://workspace.internal/secrets");
      target.searchParams.set("name", name);
      const response = await this.env.WORKSPACES.get(
        this.env.WORKSPACES.idFromName(job.workspaceId),
      ).fetch(
        withTrustedContext(
          new Request(target, {
            method: "GET",
            headers: { "x-chief-internal-operation": "secret-get" },
          }),
          {
            principal,
            requestId: crypto.randomUUID(),
            workspaceId: principal.workspaceId,
          },
        ),
      );
      if (response.ok) {
        const document = secretValueSchema.parse(await response.json());
        if (document.value) return document.value;
      }
    }
    if (this.env.OPENCODE_API_KEY) return this.env.OPENCODE_API_KEY;
    throw new Error(
      "No inference credential is configured for this workspace's hosted agents.",
    );
  }

  private traceContext(job: AgentJob) {
    return {
      workspaceId: job.workspaceId,
      agentId: job.agentId,
      conversationId: isJsonString(job.payload.conversationId)
        ? job.payload.conversationId
        : "mission-control",
      jobId: job.id,
      includeContent: this.env.HOSTED_AGENT_TRACE_CONTENT === "true",
    };
  }

  private async complete(
    leaseToken: string,
    principal: AgentPrincipal,
    outcome:
      | { status: "completed"; result: unknown }
      | { status: "failed"; error: string; retryAt?: string },
  ) {
    const response = await this.queue.complete(
      new Request("https://agent.internal/complete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ leaseToken, outcome }),
      }),
      trustedContext(principal),
    );
    if (!response.ok) {
      throw new Error(`Hosted cell completion failed (${response.status}).`);
    }
  }

  private loadJob(jobId: string) {
    const row = firstAgentRow<{ job_json: string }>(
      this.storage.sql.exec(
        "SELECT job_json FROM jobs WHERE job_id = ?",
        jobId,
      ),
    );
    return row ? agentJobSchema.parse(JSON.parse(row.job_json)) : undefined;
  }
}

function claimRequest() {
  return new Request("https://agent.internal/claim", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      workerId: "cloudflare-hosted-cell",
      leaseSeconds: 300,
    }),
  });
}

function trustedContext(principal: AgentPrincipal) {
  return {
    principal,
    requestId: crypto.randomUUID(),
    workspaceId: principal.workspaceId,
    conversationId: null,
  };
}

function compactionRatio(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0.75;
}

function retryDelay(attempt: number) {
  return Math.min(15 * 60_000, 30_000 * 2 ** Math.min(attempt, 5));
}

function hostedErrorMessage(error: string) {
  return `Chief could not complete this step: ${error.slice(0, 600)}. Chief will retry automatically.`;
}

async function parseLease(response: Response) {
  const document: unknown = await response.json();
  return hostedLeaseSchema.parse(document);
}
