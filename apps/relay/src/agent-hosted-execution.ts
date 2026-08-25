import { z } from "zod";

import type {
  agentJobCompletionResultSchema,
  AgentPrincipal,
  JsonObject,
  JsonValue,
} from "@chief/relay-contracts";
import { agentJobSchema, isJsonString } from "@chief/relay-contracts";

import type { AgentJobQueue } from "./agent-job-queue";
import type { CloudflareAgentBrowser } from "./cloudflare-agent-browser";
import type { CloudflareAgentComputer } from "./cloudflare-agent-computer";
import type { CloudflareAgentInference } from "./cloudflare-agent-inference";
import { firstAgentRow } from "./agent-job-store";
import { hostedPrincipal, safeJsonArray } from "./agent-object-values";
import {
  loadAgentHostingContext,
  runHostedAgentJob,
} from "./hosted-agent-runner";

type AgentJob = ReturnType<typeof agentJobSchema.parse>;

const hostedLeaseSchema = z.object({
  job: agentJobSchema,
  leaseToken: z.string(),
});

export class AgentHostedExecution {
  constructor(
    private readonly storage: DurableObjectStorage,
    private readonly env: Env,
    private readonly computer: CloudflareAgentComputer,
    private readonly browser: CloudflareAgentBrowser,
    private readonly inference: CloudflareAgentInference,
    private readonly queue: AgentJobQueue,
    private readonly broadcast: (event: JsonObject) => void,
  ) {}

  async runDueJob() {
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
    if (hosting?.runtime !== "cloud" || hosting.config?.enabled === false)
      return;

    const claim = await this.queue.claim(
      claimRequest(),
      trustedContext(principal),
    );
    if (claim.status === 204) return;
    const lease = await parseLease(claim);
    try {
      const result = await runHostedAgentJob(
        this.computer,
        this.browser,
        this.inference,
        this.env,
        lease.job,
        principal,
        hosting,
      );
      this.recordCellState(lease.job, result, hosting.agent);
      await this.complete(lease.leaseToken, principal, {
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
      await this.complete(lease.leaseToken, principal, {
        status: "failed",
        error: message.slice(0, 4_000),
        retryAt,
      });
    }
  }

  private async complete(
    leaseToken: string,
    principal: AgentPrincipal,
    outcome:
      | { status: "completed"; result: unknown }
      | { status: "failed"; error: string; retryAt: string },
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

  private recordCellState(
    job: AgentJob,
    result: ReturnType<typeof agentJobCompletionResultSchema.parse>,
    agent?: { id: string; name: string; role: string },
  ) {
    const conversationId = isJsonString(job.payload.conversationId)
      ? job.payload.conversationId
      : "mission-control";
    const key = `conversation:${conversationId}:messages`;
    const messages = this.loadArray(key);
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
    const journal = this.loadArray("agent:work-journal");
    journal.push({
      conversationId,
      user: instruction.slice(0, 1_000),
      assistant: answer.slice(0, 2_000),
      completedAt: now,
    });
    this.storage.transactionSync(() => {
      this.putRecord(key, messages.slice(-200), now);
      this.putRecord("agent:work-journal", journal.slice(-120), now);
      this.putRecord(
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
        this.putRecord(
          "eve:package:instructions",
          `You are ${agent.name}, the workspace's ${agent.role} agent.`,
          now,
        );
      }
    });
  }

  private loadArray(key: string) {
    const row = firstAgentRow<{ value_json: string }>(
      this.storage.sql.exec(
        "SELECT value_json FROM cell_records WHERE key = ?",
        key,
      ),
    );
    return row ? safeJsonArray(row.value_json) : [];
  }

  private putRecord(key: string, value: JsonValue, updatedAt: string) {
    this.storage.sql.exec(
      `INSERT INTO cell_records (key, value_json, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json,
         updated_at = excluded.updated_at`,
      key,
      JSON.stringify(value),
      updatedAt,
    );
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

async function parseLease(response: Response) {
  const document: unknown = await response.json();
  return hostedLeaseSchema.parse(document);
}
