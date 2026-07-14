import { randomUUID } from "node:crypto";

import type { SessionManager } from "./manager.js";
import type { AgentSession } from "./session.js";
import type {
  AgentEvent,
  RecurringWorkRecord,
  RecurringWorkRunRecord,
  RunResultArtifact,
  RuntimeNotice,
} from "./types.js";
import { composeWorkspaceInstructions, getAgent } from "./agents.js";
import {
  canonicalExecutorAddress,
  nextRunAt,
  runDateKey,
} from "./recurring-work.js";
import { existingExecutorWorkspace } from "./tools/control-plane.js";
import { executorToolServer } from "./tools/spec.js";
import { readWorkspaceContext } from "./workspace-context.js";

const POLL_INTERVAL_MS = 5_000;
const ONBOARDING_RETRY_DELAY_MS = 15_000;
const MAX_ONBOARDING_ATTEMPTS = 3;

function lastAssistantText(events: readonly AgentEvent[]) {
  return events
    .flatMap((event) =>
      event.type === "message" && event.role === "assistant"
        ? event.content.flatMap((block) =>
            block.type === "text" ? [block.text] : [],
          )
        : [],
    )
    .at(-1)
    ?.slice(0, 20_000);
}

function reportedRequiredDataFailure(summary: string | undefined) {
  if (!summary) return false;
  return /(?:CHIEF|MARKETER)_RUN_FAILED|tool_not_found|live analytics report unavailable|analytics (?:data|report) (?:is |was )?(?:not available|unavailable)|analytics (?:has|have) not (?:yet )?populated|no reliable .*data .*available/i.test(
    summary,
  );
}

function blockedRunSummary(blockedTools: readonly string[]) {
  if (
    blockedTools.includes(
      "tools.chief.org.workspace.agentTools.analyticsRunReport",
    )
  ) {
    return "Live analytics was not read. The Analyst selected the cached workspace report path instead of this task's approved live Google Analytics path. No Google permission was removed and nothing was changed. Reconnect Google Analytics if prompted, then rerun the report.";
  }
  const count = blockedTools.length;
  if (count === 0) {
    return "The connector stopped before the approved tool could run. Nothing was changed. Retry the report; if it stops again, reconnect the integration.";
  }
  return count === 1
    ? "The run stopped before using one tool outside its approved scope. Nothing was changed. Review that tool, then rerun."
    : `The run stopped before using ${count} tools outside its approved scope. Nothing was changed. Review those tools, then rerun.`;
}

function onboardingRetryAvailable(
  work: RecurringWorkRecord,
  runs: readonly RecurringWorkRunRecord[],
) {
  if (!work.id.startsWith("onboarding-") || work.runOnceAt === undefined) {
    return false;
  }
  const priorAttempts = runs.filter(
    (run) => run.recurringWorkId === work.id,
  ).length;
  return priorAttempts + 1 < MAX_ONBOARDING_ATTEMPTS;
}

type ArtifactWorkspaceData = Awaited<
  ReturnType<SessionManager["workspaceData"]>
>;

function newIds<T extends { id: string }>(before: T[], after: T[]) {
  const existing = new Set(before.map((item) => item.id));
  return after.filter((item) => !existing.has(item.id));
}

function changedIds<T extends { id: string; updatedAt: number }>(
  before: T[],
  after: T[],
) {
  const existing = new Map(before.map((item) => [item.id, item.updatedAt]));
  return after.filter((item) => existing.get(item.id) !== item.updatedAt);
}

function artifactsFromRun(
  events: readonly AgentEvent[],
  before: ArtifactWorkspaceData,
  after: ArtifactWorkspaceData,
): RunResultArtifact[] {
  const artifacts: RunResultArtifact[] = [];
  const chartIds = new Set<string>();
  for (const event of events) {
    if (event.type !== "message") continue;
    for (const block of event.content) {
      if (block.type !== "data-chart") continue;
      const id = block.id ?? `chart-${artifacts.length + 1}`;
      if (chartIds.has(id)) continue;
      chartIds.add(id);
      artifacts.push({ type: "data-chart", id, data: block.data });
    }
  }

  const prospects = newIds(before.prospects, after.prospects).slice(0, 25);
  if (prospects.length > 0) {
    artifacts.push({
      type: "data-table",
      id: "prospects",
      data: {
        title: "Prospects found",
        columns: [
          { key: "name", label: "Name" },
          { key: "company", label: "Company" },
          { key: "relevance", label: "Relevance" },
          { key: "source", label: "Source" },
        ],
        rows: prospects.map((item) => ({
          name: item.name,
          company: item.company ?? "",
          relevance: item.relevance,
          source: item.source,
        })),
      },
    });
  }

  const trends = newIds(before.trends, after.trends).slice(0, 25);
  if (trends.length > 0) {
    artifacts.push({
      type: "data-table",
      id: "trends",
      data: {
        title: "Signals found",
        columns: [
          { key: "title", label: "Signal" },
          { key: "source", label: "Source" },
          { key: "strength", label: "Strength" },
        ],
        rows: trends.map((item) => ({
          title: item.title,
          source: item.source,
          strength: item.signal,
        })),
      },
    });
  }

  const drafts = changedIds(before.drafts, after.drafts).slice(0, 25);
  if (drafts.length > 0) {
    artifacts.push({
      type: "data-table",
      id: "content",
      data: {
        title: "Content prepared",
        columns: [
          { key: "title", label: "Draft" },
          { key: "platform", label: "Channel" },
          { key: "status", label: "Status" },
        ],
        rows: drafts.map((item) => ({
          title: item.title,
          platform: item.platform,
          status: item.status,
        })),
      },
    });
  }

  const campaigns = changedIds(before.campaigns, after.campaigns).slice(0, 25);
  if (campaigns.length > 0) {
    artifacts.push({
      type: "data-table",
      id: "campaigns",
      data: {
        title: "Campaigns",
        columns: [
          { key: "name", label: "Campaign" },
          { key: "provider", label: "Provider" },
          { key: "status", label: "Status" },
          { key: "budget", label: "Budget" },
        ],
        rows: campaigns.map((item) => ({
          name: item.name,
          provider: item.provider,
          status: item.status,
          budget: item.budget ?? "",
        })),
      },
    });
  }

  return artifacts;
}

export class RecurringWorkScheduler {
  private timer: NodeJS.Timeout | null = null;
  private readonly running = new Set<string>();

  constructor(
    private readonly manager: SessionManager,
    private readonly onChange: (workspaceId: string) => void | Promise<void>,
    private readonly onNotice: (
      workspaceId: string,
      notice: RuntimeNotice,
    ) => void = () => {},
  ) {}

  /** Notices are best-effort; they must never break a run. */
  private notice(workspaceId: string, notice: RuntimeNotice) {
    try {
      this.onNotice(workspaceId, notice);
    } catch (error) {
      console.error("[scheduler] notice failed:", error);
    }
  }

  start() {
    if (this.timer) return;
    // Fire-and-forget: a failed tick logs and waits for the next interval
    // instead of surfacing an unhandled rejection that kills the runtime.
    const safeTick = () =>
      void this.tick().catch((error) =>
        console.error("[scheduler] tick failed:", error),
      );
    safeTick();
    this.timer = setInterval(safeTick, POLL_INTERVAL_MS);
    this.timer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async runNow(workspaceId: string, recurringWorkId: string) {
    const work = await this.manager.recurringWorkById(
      workspaceId,
      recurringWorkId,
    );
    if (!work) throw new Error("Recurring work was not found.");
    if (!work.grant) throw new Error("Recurring work has not been approved.");
    await this.run(workspaceId, work, Date.now(), { claim: false });
  }

  private async tick() {
    const due = await this.manager.dueRecurringWork(Date.now());
    await Promise.all(
      due.map((work) =>
        this.run(
          work.workspaceId,
          {
            ...work,
            grant: work.grant ?? undefined,
            skipDates: work.skipDates ?? undefined,
            runOnceAt: work.runOnceAt ?? undefined,
            nextRunAt: work.nextRunAt ?? undefined,
            lastRunAt: work.lastRunAt ?? undefined,
            lastResult: work.lastResult ?? undefined,
          },
          work.nextRunAt!,
          { claim: true },
        ).catch((error) =>
          console.error(`[scheduler] run ${work.id} failed:`, error),
        ),
      ),
    );
  }

  /**
   * A run's outcome must be reviewable: the transcript persists as a durable
   * conversation under the automation's name, and anything short of success
   * raises exactly one attention item with the concrete reason.
   */
  private async deliverRunOutcome(
    workspaceId: string,
    work: RecurringWorkRecord,
    session: AgentSession | null,
    status: "completed" | "failed" | "needs_approval",
    runId: string,
    detail?: string,
  ) {
    try {
      if (session) {
        await this.manager.saveTranscript(
          {
            id: `automation-run-${runId}`,
            workspaceId,
            agentId: work.agentId,
            driver: "codex",
          },
          session.events,
          work.title,
        );
      }
      this.notice(workspaceId, {
        kind:
          status === "completed"
            ? "run-completed"
            : status === "needs_approval"
              ? "run-blocked"
              : "run-failed",
        title: work.title,
        detail: detail?.trim().slice(0, 140) || undefined,
        sourceId: `automation-${work.id}`,
        agentId: work.agentId,
        chatId: `automation-run-${runId}`,
        runId,
        recurringWorkId: work.id,
      });
      if (status !== "completed") {
        await this.manager.raiseAttentionItem(workspaceId, {
          id: `attention-${work.id}-${status}`,
          agentId: work.agentId,
          title: work.title,
          reason:
            status === "needs_approval"
              ? detail?.trim() ||
                "The run stopped at an action outside its approved scope."
              : detail?.trim() || "The run failed.",
          sourceId: `automation-${work.id}`,
          status: "open",
          createdAt: Date.now(),
        });
      }
    } catch (error) {
      console.error("[scheduler] could not deliver run outcome:", error);
    }
  }

  private async run(
    workspaceId: string,
    work: RecurringWorkRecord,
    scheduledFor: number,
    { claim }: { claim: boolean },
  ) {
    if (this.running.has(work.id) || !work.grant) return;
    this.running.add(work.id);
    const now = Date.now();
    // Downtime recovery is one catch-up run, not a replay: the next
    // occurrence is computed from now when the due time is already past,
    // otherwise a week offline would refire a daily job seven times.
    const scheduleFrom = () => Math.max(scheduledFor, Date.now());
    if (claim) {
      // Scheduled dispatch must win an atomic claim on the due time so a
      // second runtime polling the same database cannot run the same job.
      const claimed = await this.manager.claimRecurringWork(
        workspaceId,
        work.id,
        scheduledFor,
        work.runOnceAt === undefined
          ? nextRunAt(work.cron, work.timezone, scheduleFrom())
          : null,
      );
      if (!claimed) {
        this.running.delete(work.id);
        return;
      }
    } else {
      await this.manager.saveRecurringWork(workspaceId, {
        ...work,
        nextRunAt:
          work.runOnceAt === undefined
            ? nextRunAt(work.cron, work.timezone, scheduleFrom())
            : undefined,
        updatedAt: now,
      });
    }
    // A skipped occurrence consumes its claim (nextRunAt already advanced)
    // without executing, and the spent skip date is cleared.
    const skipKey = runDateKey(scheduledFor, work.timezone);
    if (claim && work.skipDates?.includes(skipKey)) {
      await this.manager.saveRecurringWork(workspaceId, {
        ...work,
        status: work.runOnceAt === undefined ? work.status : "paused",
        skipDates: work.skipDates.filter((date) => date !== skipKey),
        nextRunAt:
          work.runOnceAt === undefined
            ? nextRunAt(work.cron, work.timezone, scheduleFrom())
            : undefined,
        updatedAt: Date.now(),
      });
      this.running.delete(work.id);
      await this.onChange(workspaceId);
      return;
    }

    const run: RecurringWorkRunRecord = {
      id: randomUUID(),
      recurringWorkId: work.id,
      status: "running",
      scheduledFor,
      startedAt: now,
    };
    const beforeData = await this.manager.workspaceData(workspaceId);

    let session: AgentSession | null = null;
    let blocked = false;
    const blockedTools: string[] = [];
    try {
      await this.manager.saveRecurringWorkRun(workspaceId, run);
      await this.onChange(workspaceId);
      this.notice(workspaceId, {
        kind: "run-started",
        title: work.title,
        detail: "Your agent is working on this now.",
        sourceId: `automation-${work.id}`,
        agentId: work.agentId,
        chatId: `automation-run-${run.id}`,
        runId: run.id,
        recurringWorkId: work.id,
      });
      const agent = getAgent(work.agentId);
      if (!agent) throw new Error(`Unknown agent: ${work.agentId}`);
      const preference = await this.manager.agentPreference(
        workspaceId,
        work.agentId,
      );
      if (preference?.enabled === false) {
        throw new Error(`${agent.name} is disabled.`);
      }

      const executor = existingExecutorWorkspace(workspaceId);
      const approved = work.grant.toolPatterns.map(canonicalExecutorAddress);
      const liveGoogleAnalyticsApproved = approved.some((address) =>
        [
          "tools.chief.org.workspace.agentTools.analyticsRunReport",
          "tools.chief-local.org.localworkspace.localTools.googleAnalyticsRunReport",
        ].includes(address),
      );
      const effectiveApproved = liveGoogleAnalyticsApproved
        ? [
            ...new Set([
              ...approved,
              "tools.chief-local.org.localworkspace.localTools.googleAnalyticsRunReport",
            ]),
          ]
        : approved;
      const isOnboardingSetup =
        work.agentId === "setup" &&
        work.id.startsWith("onboarding-") &&
        work.runOnceAt !== undefined;
      const unattendedAccessRules = isOnboardingSetup
        ? "This is an approved onboarding setup run. Work proactively and use the local shell, browser, existing machine credentials, and Executor when they help complete the selected setup. Never expose secrets. Ask for browser consent, an account choice, or a missing credential only when it genuinely requires the user."
        : "This is an unattended recurring run that the user approved in Chief. Use Executor only; do not use shell commands or edit files.";
      const scheduledAgent = {
        ...agent,
        instructions: composeWorkspaceInstructions(
          `${agent.instructions}\n\n${unattendedAccessRules} You may call only these exact delegated Executor tool addresses: ${effectiveApproved.length > 0 ? effectiveApproved.join(", ") : "read-only tools that Executor already allows"}. Do not substitute a similarly named tool from another integration.${liveGoogleAnalyticsApproved ? " The live local Google Analytics report tool is approved. Always call tools.chief-local.org.localworkspace.localTools.googleAnalyticsRunReport for Google Analytics, even when an older task instruction names tools.chief.org.workspace.agentTools.analyticsRunReport or the workspace source says cached. The cached source is discovery metadata, not the report to analyze. Call the local report tool with body: { propertyId, startDate, endDate, metrics: [string], dimensions: [string], limit }. Never use dateRanges or objects with a name property." : ""} If the task needs any other mutation, stop and explain what additional approval is required. Produce a decision-ready result, not only prose. Present numeric time series as focused charts. Multiple charts are encouraged when the evidence covers different questions. Each chart must contain only directly comparable series, use one measurement scale, and order time points chronologically. Never combine daily traffic, acquisition groups, landing pages, and events into one chart. Make created or updated campaigns, prospects, signals, and content explicit so Chief can show them as tables. Put concise analysis beside the artifact. Never publish connector errors, tool names, authorization details, missing-data complaints, or debugging instructions as a report. If required evidence is unavailable, retry the approved live read tool once. If it still fails, return only CHIEF_RUN_FAILED followed by one short plain-language cause. Use direct sales-style language and never use an em dash character.`,
          readWorkspaceContext(workspaceId),
        ),
      };
      session = await this.manager.ensure(
        scheduledAgent,
        `automation-run-${run.id}`,
        {
          // Codex currently exposes Executor's native MCP elicitation to the
          // host, allowing this grant to be enforced before every mutation.
          driver: "codex",
          // Setup work is explicitly selected during onboarding. It needs
          // local browser, credential and shell access to complete OAuth and
          // machine setup rather than immediately declining those actions.
          // Executor still enforces the automation's narrow tool grant.
          access: isOnboardingSetup ? "full" : "guarded",
          workspaceId,
          model: preference?.model,
          mcpServers: [executorToolServer(executor)],
          automationGrant: work.grant,
        },
      );

      const result = await new Promise<{ ok: boolean; error?: string }>(
        async (resolve, reject) => {
          const timeout = setTimeout(
            () => reject(new Error("Recurring work timed out.")),
            10 * 60_000,
          );
          timeout.unref();
          session!.on("event", (event: AgentEvent) => {
            if (event.type === "permission") {
              if (
                event.toolName.startsWith("tools.") &&
                !blockedTools.includes(event.toolName)
              ) {
                blocked = true;
                blockedTools.push(event.toolName);
              }
            }
            if (event.type === "result") {
              clearTimeout(timeout);
              resolve({ ok: event.ok, error: event.error });
            }
            if (event.type === "error") {
              clearTimeout(timeout);
              resolve({ ok: false, error: event.message });
            }
          });
          try {
            await session!.sendPrompt(
              `Run this approved recurring work now.\n\n${work.instructions}\n\nReturn a concise result with a clear headline, the evidence, the next action, what was saved or sent, and anything that needs the user's attention. Use bullets where they improve scanning. Do not use an em dash character.`,
            );
            await this.manager.saveTranscript(
              {
                id: `automation-run-${run.id}`,
                workspaceId,
                agentId: work.agentId,
                driver: "codex",
                model: preference?.model,
              },
              session!.events,
              work.title,
            );
          } catch (error) {
            clearTimeout(timeout);
            reject(error);
          }
        },
      );

      const agentSummary = lastAssistantText(session.events);
      const dataFailure = reportedRequiredDataFailure(agentSummary);
      const artifacts = await this.manager
        .workspaceData(workspaceId)
        .then((afterData) =>
          artifactsFromRun(session!.events, beforeData, afterData),
        )
        .catch(() => []);
      const status = blocked
        ? "needs_approval"
        : result.ok && !dataFailure
          ? "completed"
          : "failed";
      const summary = blocked
        ? blockedRunSummary(blockedTools)
        : dataFailure
          ? "Analytics data was unavailable for this run. Nothing was changed. Try again."
          : agentSummary;
      const retrying =
        status === "failed" &&
        onboardingRetryAvailable(work, beforeData.recurringWorkRuns);
      await this.manager.saveRecurringWorkRun(workspaceId, {
        ...run,
        status,
        finishedAt: Date.now(),
        summary,
        artifacts: artifacts.length > 0 ? artifacts : undefined,
        error: result.error,
        blockedTools: blockedTools.length > 0 ? blockedTools : undefined,
      });
      // Every run leaves a reviewable transcript, and a blocked run raises
      // one concrete attention item instead of failing silently.
      if (!retrying) {
        await this.deliverRunOutcome(
          workspaceId,
          work,
          session,
          status,
          run.id,
          summary,
        );
      }
      if (status === "completed") {
        for (const suffix of ["approval", "needs_approval", "failed"]) {
          await this.manager.dismissAttentionItem(
            workspaceId,
            `attention-${work.id}-${suffix}`,
          );
        }
      }
      await this.manager.saveRecurringWork(workspaceId, {
        ...work,
        status: retrying
          ? "active"
          : blocked
            ? "needs_approval"
            : work.runOnceAt === undefined
              ? "active"
              : "paused",
        nextRunAt: retrying
          ? Date.now() + ONBOARDING_RETRY_DELAY_MS
          : work.runOnceAt === undefined
            ? nextRunAt(work.cron, work.timezone, scheduleFrom())
            : undefined,
        lastRunAt: Date.now(),
        lastResult: summary ?? result.error,
        updatedAt: Date.now(),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const artifacts = session
        ? await this.manager
            .workspaceData(workspaceId)
            .then((afterData) =>
              artifactsFromRun(session!.events, beforeData, afterData),
            )
            .catch(() => [])
        : [];
      await this.manager.saveRecurringWorkRun(workspaceId, {
        ...run,
        status: blocked ? "needs_approval" : "failed",
        finishedAt: Date.now(),
        error: message,
        artifacts: artifacts.length > 0 ? artifacts : undefined,
      });
      const retrying =
        !blocked &&
        onboardingRetryAvailable(work, beforeData.recurringWorkRuns);
      if (!retrying) {
        await this.deliverRunOutcome(
          workspaceId,
          work,
          session,
          blocked ? "needs_approval" : "failed",
          run.id,
          message,
        );
      }
      await this.manager.saveRecurringWork(workspaceId, {
        ...work,
        // A transient provider or network failure is recorded on the run but
        // does not silently disable an automation the user approved forever.
        status: retrying
          ? "active"
          : blocked
            ? "needs_approval"
            : work.runOnceAt === undefined
              ? "active"
              : "error",
        nextRunAt: retrying
          ? Date.now() + ONBOARDING_RETRY_DELAY_MS
          : blocked
            ? work.nextRunAt
            : work.runOnceAt === undefined
              ? nextRunAt(work.cron, work.timezone, scheduleFrom())
              : undefined,
        lastRunAt: Date.now(),
        lastResult: message,
        updatedAt: Date.now(),
      });
    } finally {
      await session?.stop().catch(() => {});
      this.running.delete(work.id);
      await this.onChange(workspaceId);
    }
  }
}
