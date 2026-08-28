import { Effect } from "effect";

import type {
  AgentJob,
  AgentPrincipal,
  JsonObject,
} from "@chief/relay-contracts";
import {
  DurableTurnRunner,
  measureDurableTurnState,
} from "@chief/agent-runtime/durable-turn";
import { agentJobSchema, isJsonString } from "@chief/relay-contracts";

import type {
  AgentExecutionEnvironment,
  AgentExecutionEnvironmentFactory,
} from "./agent-execution-environment";
import type { AgentJobQueue } from "./agent-job-queue";
import type { TurnFailure } from "./agent-runtime-support";
import { publishAgentErrorActivity } from "./agent-activity";
import { recordCompletedTurn } from "./agent-cell-projection";
import { agentCellPersistence } from "./agent-cell-storage";
import { hostedActivityObserver } from "./agent-hosted-activity";
import { executeObservedHostedAgentTool } from "./agent-hosted-tool-execution";
import { firstAgentRow } from "./agent-job-store";
import { hostedPrincipal } from "./agent-object-values";
import {
  agentRetryDelay,
  completeAgentJob,
  hostedClaimRequest,
  hostedCompactionRatio,
  hostedErrorMessage,
  internalFailureMessage,
  parseHostedLease,
  resolveInferenceApiKey,
  trustedAgentContext,
} from "./agent-runtime-support";
import {
  agentTelemetryAttributes,
  agentWorkflowId,
  durableTurnStateAttributes,
  traceAgentRun,
  tracedInference,
  traceToolExecution,
} from "./agent-tracing";
import { supersedeConversationTurn } from "./agent-turn-supersession";
import { createAiSdkAgentInference } from "./ai-sdk-agent-inference";
import { asyncTracer, attempt, sync, telemetryIncludesContent } from "./effect";
import {
  hostedTurnResult,
  loadAgentHostingContext,
  prepareHostedAgentTurn,
} from "./hosted-agent-runner";
import { hostedDurableTools } from "./hosted-agent-tools";

export class AgentRuntime {
  private readonly turns: DurableTurnRunner;

  constructor(
    private readonly storage: DurableObjectStorage,
    private readonly env: Env,
    private readonly executionFor: AgentExecutionEnvironmentFactory,
    private readonly queue: AgentJobQueue,
    private readonly broadcast: (event: JsonObject) => void,
  ) {
    this.turns = new DurableTurnRunner(agentCellPersistence(storage), "agent", {
      compactionRatio: hostedCompactionRatio(env.HOSTED_AGENT_COMPACTION_RATIO),
    });
  }

  runDueJob() {
    const { turns } = this;
    const continueTurn = this.continueTurn.bind(this);
    const admitDueJob = this.admitDueJob.bind(this);
    return Effect.gen(function* () {
      const active = yield* attempt("agent.turn.active", () => turns.active());
      if (active) {
        return yield* continueTurn(active.jobId);
      }
      return yield* admitDueJob();
    }).pipe(Effect.withSpan("agent.alarm"));
  }

  async currentWorkflowId() {
    const active = await this.turns.active();
    if (active) {
      const job = this.loadJob(active.jobId);
      return job ? agentWorkflowId(job) : undefined;
    }
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
    return due
      ? agentWorkflowId(agentJobSchema.parse(JSON.parse(due.job_json)))
      : undefined;
  }

  async supersedeConversation(
    conversationId: string,
    replacementJobId: string,
  ) {
    return supersedeConversationTurn({
      conversationId,
      replacementJobId,
      turns: this.turns,
      queue: this.queue,
      loadJob: (jobId) => this.loadJob(jobId),
    });
  }

  scheduleNextAlarm() {
    const { queue, storage, turns } = this;
    return Effect.gen(function* () {
      const turnWake = yield* attempt("agent.turn.next_wake", () =>
        turns.nextWakeAt(),
      );
      if (turnWake !== undefined) {
        return yield* attempt("agent.alarm.set", () =>
          storage.setAlarm(turnWake),
        );
      }
      return yield* attempt("agent.queue.schedule", () =>
        queue.scheduleNextAlarm(),
      );
    }).pipe(Effect.withSpan("agent.alarm.schedule"));
  }

  private admitDueJob() {
    const { broadcast, env, queue, storage, turns } = this;
    const failAdmission = this.failAdmission.bind(this);
    const scheduleNextAlarm = this.scheduleNextAlarm.bind(this);
    return Effect.gen(function* () {
      const now = new Date().toISOString();
      const due = yield* sync("agent.job.find_due", () =>
        firstAgentRow<{ job_json: string }>(
          storage.sql.exec(
            `SELECT job_json FROM jobs
             WHERE (status = 'pending' AND available_at <= ?)
                OR (status = 'leased' AND lease_expires_at <= ?)
             ORDER BY available_at ASC, rowid ASC LIMIT 1`,
            now,
            now,
          ),
        ),
      );
      if (!due) {
        return yield* attempt("agent.queue.schedule", () =>
          queue.scheduleNextAlarm(),
        );
      }
      const job = yield* sync("agent.job.decode", () =>
        agentJobSchema.parse(JSON.parse(due.job_json)),
      );
      yield* Effect.annotateCurrentSpan(agentTelemetryAttributes(job));
      yield* Effect.logInfo({
        event: "agent.job.due",
        ...agentTelemetryAttributes(job),
      });
      yield* sync("agent.job.broadcast", () =>
        broadcast({
          type: "agent.job.available",
          occurredAt: now,
          payload: { agentId: job.agentId, jobId: job.id, kind: job.kind },
        }),
      );
      if (env.HOSTED_CELL_ENABLED !== "true") return;
      const principal = hostedPrincipal(job);
      const hosting = yield* attempt("agent.context.load", () =>
        loadAgentHostingContext(env, job, principal),
      );
      if (hosting?.runtime !== "cloud" || hosting.config?.enabled === false) {
        return;
      }
      if (!hosting.config) {
        throw new Error("The hosted agent configuration is unavailable.");
      }
      yield* Effect.annotateCurrentSpan({
        "chief.workspace.name": hosting.workspace?.name ?? job.workspaceId,
      });
      const response = yield* attempt("agent.job.claim", () =>
        queue.claim(hostedClaimRequest(), trustedAgentContext(principal)),
      );
      if (response.status === 204) return;
      const lease = yield* attempt("agent.job.lease.decode", () =>
        parseHostedLease(response),
      );
      const admission = Effect.gen(function* () {
        const prepared = yield* attempt("agent.turn.prepare", () =>
          prepareHostedAgentTurn(env, lease.job, principal, hosting, storage),
        );
        yield* attempt("agent.turn.create", () =>
          turns.create({
            ...prepared,
            leaseToken: lease.leaseToken,
          }),
        );
        yield* scheduleNextAlarm();
      });
      return yield* admission.pipe(
        Effect.matchEffect({
          onFailure: (failure) =>
            failAdmission(
              lease.job,
              lease.leaseToken,
              principal,
              hosting.workspace?.name ?? lease.job.workspaceId,
              new Error(failure.message),
            ),
          onSuccess: () => Effect.void,
        }),
      );
    }).pipe(Effect.withSpan("agent.job.admit"));
  }

  private continueTurn(jobId: string) {
    const { env, executionFor, queue, storage, turns } = this;
    const deferTurn = this.deferTurn.bind(this);
    const failTurn = this.failTurn.bind(this);
    const loadJob = this.loadJob.bind(this);
    const scheduleNextAlarm = this.scheduleNextAlarm.bind(this);
    const settleTurn = this.settleTurn.bind(this);
    const traceContextFor = this.traceContext.bind(this);
    return Effect.gen(function* () {
      const turn = yield* attempt("agent.turn.active", () => turns.active());
      if (!turn || turn.jobId !== jobId) return;
      const job = yield* sync("agent.job.load", () => loadJob(jobId));
      if (!job) {
        yield* attempt("agent.turn.settle", () => turns.markSettled());
        return yield* scheduleNextAlarm();
      }
      const principal = hostedPrincipal(job);
      const maintained = yield* sync("agent.job.lease.maintain", () =>
        queue.maintainHostedLease(job.id, turn.leaseToken, principal, 900),
      );
      if (!maintained) {
        yield* attempt("agent.turn.settle", () => turns.markSettled());
        return yield* scheduleNextAlarm();
      }
      if (maintained.leaseToken !== turn.leaseToken) {
        yield* attempt("agent.turn.lease.update", () =>
          turns.updateLeaseToken(maintained.leaseToken),
        );
      }
      const current = yield* attempt("agent.turn.reload", () => turns.active());
      if (!current) return;
      yield* Effect.annotateCurrentSpan({
        ...agentTelemetryAttributes(maintained.job),
        ...durableTurnStateAttributes(measureDurableTurnState(current)),
      });
      const execution = executionFor();
      if (current.phase.kind !== "runnable") {
        return yield* settleTurn(maintained.job, principal);
      }
      const hosting = yield* attempt("agent.context.load", () =>
        loadAgentHostingContext(env, maintained.job, principal),
      );
      if (!hosting?.config || hosting.runtime !== "cloud") {
        return yield* failTurn(
          maintained.job,
          principal,
          execution,
          "The hosted agent configuration is unavailable.",
        );
      }
      const config = hosting.config;
      const workspaceName =
        hosting.workspace?.name ?? maintained.job.workspaceId;
      yield* Effect.annotateCurrentSpan({
        "chief.workspace.name": workspaceName,
      });
      yield* Effect.logInfo({
        event: "agent.turn.started",
        ...agentTelemetryAttributes(maintained.job),
        "chief.workspace.name": workspaceName,
        "chief.turn.revision": current.revision,
      });
      const advance = Effect.gen(function* () {
        const apiKey = yield* resolveInferenceApiKey(
          env,
          maintained.job,
          principal,
          config,
        );
        const browserEnabled = current.browserEnabled;
        const tools = hostedDurableTools(current);
        const traceContext = traceContextFor(maintained.job, workspaceName);
        const tracer = yield* asyncTracer;
        const result = yield* attempt("agent.turn.advance", () =>
          traceAgentRun(tracer, traceContext, current.revision, (turnTracer) =>
            turns.advance({
              inference: tracedInference(
                createAiSdkAgentInference(apiKey, traceContext),
                traceContext,
                turnTracer,
              ),
              tools,
              observer: hostedActivityObserver(env, maintained.job, principal),
              scheduleRecovery: async (wakeAt) =>
                await storage.setAlarm(wakeAt),
              executor: {
                execute: async (call) =>
                  await traceToolExecution(turnTracer, traceContext, call, () =>
                    executeObservedHostedAgentTool(
                      execution,
                      browserEnabled,
                      current.computerEnabled,
                      env,
                      maintained.job,
                      principal,
                      call.name,
                      call.arguments,
                    ),
                  ),
              },
            }),
          ),
        );
        if (result.kind === "sleeping") {
          return yield* attempt("agent.alarm.set", () =>
            storage.setAlarm(result.wakeAt),
          );
        }
        if (result.kind === "terminal") {
          return yield* settleTurn(maintained.job, principal);
        }
        return yield* scheduleNextAlarm();
      });
      return yield* advance.pipe(
        Effect.matchEffect({
          onFailure: (failure) =>
            deferTurn(maintained.job, principal, workspaceName, failure),
          onSuccess: () => Effect.void,
        }),
      );
    }).pipe(
      Effect.withSpan("agent.turn.continue", {
        attributes: { "chief.job.id": jobId },
      }),
    );
  }

  private settleTurn(job: AgentJob, principal: AgentPrincipal) {
    const { env, queue, storage, turns } = this;
    const scheduleNextAlarm = this.scheduleNextAlarm.bind(this);
    return Effect.gen(function* () {
      const turn = yield* attempt("agent.turn.active", () => turns.active());
      if (!turn) return;
      if (turn.phase.kind === "completed") {
        const result = hostedTurnResult(job, turn.phase.result);
        const hosting = yield* attempt("agent.context.load", () =>
          loadAgentHostingContext(env, job, principal),
        );
        yield* sync("agent.turn.project", () =>
          recordCompletedTurn(storage, job, result, hosting?.agent),
        );
        yield* completeAgentJob(queue, turn.leaseToken, principal, {
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
        yield* completeAgentJob(queue, turn.leaseToken, principal, {
          status: "failed",
          error,
        });
      }
      yield* attempt("agent.turn.settle", () => turns.markSettled());
      yield* scheduleNextAlarm();
    }).pipe(Effect.withSpan("agent.turn.settle"));
  }

  private failTurn(
    job: AgentJob,
    principal: AgentPrincipal,
    execution: AgentExecutionEnvironment,
    message: string,
  ) {
    const { queue, turns } = this;
    const scheduleNextAlarm = this.scheduleNextAlarm.bind(this);
    return Effect.gen(function* () {
      const turn = yield* attempt("agent.turn.active", () => turns.active());
      if (!turn) return;
      yield* completeAgentJob(queue, turn.leaseToken, principal, {
        status: "failed",
        error: message,
      });
      yield* attempt("agent.turn.settle", () => turns.markSettled());
      yield* Effect.ignore(
        attempt("agent.browser.close", () => execution.browser.close()),
      );
      yield* scheduleNextAlarm();
    });
  }

  private deferTurn(
    job: AgentJob,
    principal: AgentPrincipal,
    workspaceName: string,
    failure: TurnFailure,
  ) {
    const { env, storage, turns } = this;
    return Effect.gen(function* () {
      const wakeAt = Date.now() + agentRetryDelay(job.attempt);
      yield* attempt("agent.turn.defer", () => turns.deferUntil(wakeAt));
      yield* Effect.logError("Agent turn interrupted", {
        workspaceId: job.workspaceId,
        workspaceName,
        agentId: job.agentId,
        jobId: job.id,
        cause: internalFailureMessage(failure),
        errorCode: failure.code,
        errorStatus: failure.status,
        retryAt: new Date(wakeAt).toISOString(),
      });
      yield* attempt("agent.activity.error", () =>
        publishAgentErrorActivity(env, {
          principal,
          conversationId: isJsonString(job.payload.conversationId)
            ? job.payload.conversationId
            : "mission-control",
          seed: `${job.id}:hosted-run`,
          code: "agent_run_failed",
          title: "Agent run interrupted",
          message: hostedErrorMessage(failure.message),
          jobId: job.id,
          retryable: true,
        }).catch(() => undefined),
      );
      yield* attempt("agent.alarm.set", () => storage.setAlarm(wakeAt));
    });
  }

  private failAdmission(
    job: AgentJob,
    leaseToken: string,
    principal: AgentPrincipal,
    workspaceName: string,
    error: Error,
  ) {
    const { queue } = this;
    return Effect.gen(function* () {
      const retryAt = new Date(
        Date.now() + agentRetryDelay(job.attempt),
      ).toISOString();
      yield* Effect.logError("Agent admission failed", {
        workspaceId: job.workspaceId,
        workspaceName,
        agentId: job.agentId,
        jobId: job.id,
        cause: error.message,
        retryAt,
      });
      yield* completeAgentJob(queue, leaseToken, principal, {
        status: "failed",
        error: error.message.slice(0, 4_000),
        retryAt,
      });
    });
  }

  private traceContext(job: AgentJob, workspaceName: string) {
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
      includeContent: telemetryIncludesContent(this.env),
    };
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
