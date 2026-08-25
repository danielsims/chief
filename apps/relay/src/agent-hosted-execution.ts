import { z } from "zod";

import type {
  AgentConfig,
  agentJobCompletionResultSchema,
  AgentPrincipal,
  JsonObject,
  JsonValue,
} from "@chief/relay-contracts";
import { agentJobSchema, isJsonString } from "@chief/relay-contracts";

import type { AgentJobQueue } from "./agent-job-queue";
import type { CloudflareAgentBrowser } from "./cloudflare-agent-browser";
import type { CloudflareAgentComputer } from "./cloudflare-agent-computer";
import { publishAgentErrorActivity } from "./agent-activity-error";
import { firstAgentRow } from "./agent-job-store";
import { hostedPrincipal, safeJsonArray } from "./agent-object-values";
import {
  loadAgentHostingContext,
  runHostedAgentJob,
} from "./hosted-agent-runner";
import { withTrustedContext } from "./internal-context";
import { createOpenCodeAgentInference } from "./opencode-agent-inference";

type AgentJob = ReturnType<typeof agentJobSchema.parse>;

const hostedLeaseSchema = z.object({
  job: agentJobSchema,
  leaseToken: z.string(),
});

const secretValueSchema = z.object({
  value: z.string().optional(),
});

export class AgentHostedExecution {
  constructor(
    private readonly storage: DurableObjectStorage,
    private readonly env: Env,
    private readonly computer: CloudflareAgentComputer,
    private readonly browser: CloudflareAgentBrowser,
    private readonly queue: AgentJobQueue,
    private readonly broadcast: (event: JsonObject) => void,
  ) {}

  /** Resolves the provider API key for a hosted run. Prefers the workspace's
   * own secret (inference.secretRef); falls back to the relay default so
   * workspaces that never supplied a key keep working. The secret is read
   * from the workspace DO under the acting agent's identity. */
  private async resolveInferenceApiKey(
    job: AgentJob,
    principal: AgentPrincipal,
    config: AgentConfig,
  ): Promise<string> {
    // Resolution order: the agent's explicit inference.secretRef, then a
    // workspace secret named after the provider ("opencode"), then the relay
    // default key. A workspace that entered its own key is always preferred so
    // per-workspace isolation actually holds.
    const candidates = [
      config.inference.secretRef,
      secretRefForProvider(config.inference.provider),
    ].filter((name): name is string => Boolean(name));
    for (const name of candidates) {
      const workspace = this.env.WORKSPACES.get(
        this.env.WORKSPACES.idFromName(job.workspaceId),
      );
      const target = new URL(`https://workspace.internal/secrets`);
      target.searchParams.set("name", name);
      const response = await workspace.fetch(
        withTrustedContext(
          new Request(target, {
            method: "GET",
            headers: { "x-chief-internal-operation": "secret-get" },
          }),
          {
            principal,
            requestId: crypto.randomUUID(),
            workspaceId: job.workspaceId,
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
    if (!hosting.config) {
      throw new Error("The hosted agent configuration is unavailable.");
    }

    const claim = await this.queue.claim(
      claimRequest(),
      trustedContext(principal),
    );
    if (claim.status === 204) return;
    const lease = await parseLease(claim);
    try {
      const apiKey = await this.resolveInferenceApiKey(
        lease.job,
        principal,
        hosting.config,
      );
      const result = await runHostedAgentJob(
        this.computer,
        this.browser,
        createOpenCodeAgentInference(apiKey),
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
        cause: message,
        message: `Hosted cell execution failed: ${message.slice(0, 1_000)}`,
        retryAt,
      });
      const conversationId = isJsonString(lease.job.payload.conversationId)
        ? lease.job.payload.conversationId
        : "mission-control";
      const threadRootId = isJsonString(lease.job.payload.threadRootId)
        ? lease.job.payload.threadRootId
        : undefined;
      await publishAgentErrorActivity(this.env, {
        principal,
        conversationId,
        ...(threadRootId ? { threadRootId } : undefined),
        seed: `${lease.job.id}:hosted-run`,
        code: "agent_run_failed",
        title: "Agent run failed",
        message: hostedErrorMessage(message),
      }).catch((publishError) =>
        console.error("Hosted cell error activity failed", {
          workspaceId: lease.job.workspaceId,
          agentId: lease.job.agentId,
          jobId: lease.job.id,
          error:
            publishError instanceof Error
              ? publishError.message
              : "Unknown activity publication error.",
        }),
      );
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

function hostedErrorMessage(error: string) {
  // Surface the real cause so an operator can act, rather than a blanket
  // "could not complete" that hides everything. Always append the concrete
  // reason so the activity panel shows what actually failed.
  if (error.startsWith("OpenCode inference failed")) {
    return `OpenCode could not complete this run: ${error.slice(0, 600)}. Chief will retry automatically.`;
  }
  if (error.includes("OpenCode Go is not configured")) {
    return `Hosted OpenCode inference is not configured. Chief will retry after it is restored.`;
  }
  if (error.startsWith("Chief's workspace setup could not be finalized")) {
    return error.slice(0, 1_000);
  }
  return `Chief could not complete this run: ${error.slice(0, 600)}. Chief will retry automatically.`;
}

function secretRefForProvider(provider: string) {
  // The provider literal in the config maps to a canonical workspace secret
  // name. Only "opencode" has a hosted integration today.
  if (provider === "opencode") return "opencode";
  return undefined;
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
