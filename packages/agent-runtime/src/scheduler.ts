import { randomUUID } from "node:crypto";

import type { SessionManager } from "./manager.js";
import type { AgentSession } from "./session.js";
import type { ExecutorWorkspace } from "./tools/control-plane.js";
import type {
  AgentEvent,
  InputRequest,
  RecurringWorkRecord,
  RecurringWorkRunRecord,
  RunResultArtifact,
  RuntimeNotice,
} from "./types.js";
import { composeWorkspaceInstructions } from "./agents.js";
import { authorizeContextRequest } from "./input-values.js";
import {
  canonicalExecutorAddress,
  nextRunAt,
  runDateKey,
} from "./recurring-work.js";
import {
  isTransientRuntimeError,
  TRANSIENT_RETRY_DELAY_MS,
  transientRetryOutcome,
} from "./retry-policy.js";
import { hasPotentialSideEffects } from "./run-safety.js";
import {
  deferForAgentConfiguration,
  scheduledAgentConfig,
} from "./scheduled-agent-config.js";
import { executorToolServer } from "./tools/spec.js";
import { readWorkspaceContext } from "./workspace-context.js";

const POLL_INTERVAL_MS = 5_000;
const RECOVERY_COOLDOWN_MS = 60 * 60_000;

interface SetupRequirement {
  category: "analytics" | "ads" | "social" | "research" | "other";
  providers: string[];
  reason: string;
}

const INTERNAL_PROVIDERS = new Set(["chief", "chief-local"]);

/**
 * Older agents sometimes mislabeled missing business context as an
 * integration. Convert that result into an answerable card instead of
 * spawning a Setup agent to "connect" Chief to itself.
 */
function workspaceContextRequest(
  requirement: SetupRequirement | null,
  work: RecurringWorkRecord,
): InputRequest | null {
  if (
    requirement?.category !== "other" ||
    !requirement.providers.length ||
    !requirement.providers.every((provider) =>
      INTERNAL_PROVIDERS.has(provider.toLowerCase()),
    )
  ) {
    return null;
  }

  const contentContext =
    work.agentId === "content" ||
    /founder voice|brand voice|channel preference/i.test(requirement.reason);
  return {
    id: `workspace-context-${work.id}`,
    title: contentContext
      ? "How should this content sound?"
      : `What should Chief know before continuing ${work.title}?`,
    reason: contentContext
      ? "Share one representative writing example and the channels you care about. Chief will save the answer to this workspace and continue the run."
      : requirement.reason,
    fields: [
      {
        key: "answer",
        label: contentContext
          ? "Writing example and preferred channels"
          : "Your answer",
        type: "multiline",
        save: {
          contextKey: contentContext
            ? "Founder voice and preferred content channels"
            : `Context for ${work.title}`,
        },
      },
    ],
  };
}

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

function requestedInputSummary(summary: string | undefined) {
  const line = summary
    ?.split("\n")
    .find((candidate) => candidate.trim().startsWith("CHIEF_INPUT_REQUEST "));
  if (!line) return null;
  try {
    const request = JSON.parse(
      line.trim().slice("CHIEF_INPUT_REQUEST ".length),
    ) as { title?: unknown };
    return typeof request.title === "string" && request.title.trim()
      ? `${request.title.trim()}. Complete the requested fields to continue.`
      : "This setup needs information from you before it can continue.";
  } catch {
    return "This setup needs information from you before it can continue.";
  }
}

function requestedSetupRequirement(
  summary: string | undefined,
  work: RecurringWorkRecord,
  fallbackReason?: string | null,
): SetupRequirement | null {
  const line = summary
    ?.split("\n")
    .find((candidate) => candidate.trim().startsWith("CHIEF_SETUP_REQUIRED "));
  if (line) {
    try {
      const parsed = JSON.parse(
        line.trim().slice("CHIEF_SETUP_REQUIRED ".length),
      ) as Record<string, unknown>;
      const category = ["analytics", "ads", "social", "research"].includes(
        String(parsed.category),
      )
        ? (parsed.category as SetupRequirement["category"])
        : "other";
      const providers = Array.isArray(parsed.providers)
        ? parsed.providers
            .filter((provider): provider is string =>
              Boolean(typeof provider === "string" && provider.trim()),
            )
            .map((provider) => provider.trim())
            .slice(0, 8)
        : [];
      const reason =
        typeof parsed.reason === "string" && parsed.reason.trim()
          ? parsed.reason.trim()
          : (fallbackReason ?? "A required source is not connected.");
      return { category, providers, reason };
    } catch {
      // Fall through to the safe agent-specific recovery below.
    }
  }
  if (!fallbackReason) return null;
  if (work.agentId === "analyst") {
    return {
      category: "analytics",
      providers: ["google-analytics"],
      reason: fallbackReason,
    };
  }
  if (work.agentId === "prospector") {
    return {
      category: "research",
      providers: ["reddit.com", "x.com"],
      reason: fallbackReason,
    };
  }
  if (work.agentId === "content") {
    return {
      category: "social",
      providers: ["x.com", "linkedin.com", "instagram.com"],
      reason: fallbackReason,
    };
  }
  return { category: "other", providers: [], reason: fallbackReason };
}

function resumeWorkId(instructions: string) {
  return /^CHIEF_RESUME_WORK_ID\s+([^\s]+)\s*$/m.exec(instructions)?.[1];
}

function setupResultConnected(summary: string | undefined) {
  const line = summary
    ?.split("\n")
    .find((candidate) => candidate.trim().startsWith("CHIEF_SETUP_RESULT "));
  if (!line) return false;
  try {
    const result = JSON.parse(
      line.trim().slice("CHIEF_SETUP_RESULT ".length),
    ) as { status?: unknown };
    return result.status === "connected";
  } catch {
    return false;
  }
}

function reportedRequiredDataFailure(
  summary: string | undefined,
  analyticsRequired: boolean,
) {
  if (!summary) return null;
  const marker = /(?:CHIEF|MARKETER)_RUN_FAILED\s*:?[ \t]*(.+)?/i.exec(summary);
  if (marker) {
    const cause = marker[1]?.trim();
    return cause?.length ? cause : "The required source could not be read.";
  }
  if (/tool_not_found/i.test(summary)) {
    return "The required connector was not available to this run.";
  }
  if (
    analyticsRequired &&
    /live analytics report unavailable|analytics (?:data|report) (?:is |was )?(?:not available|unavailable)|analytics (?:has|have) not (?:yet )?populated|no reliable .*data .*available/i.test(
      summary,
    )
  ) {
    return "Google Analytics could not be read for this run.";
  }
  return null;
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

function safeRunFailure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (/Failed query:|insert into|update .+ set|SQLITE_/i.test(message)) {
    return "Chief could not save this run cleanly. Nothing external was changed.";
  }
  return message.slice(0, 1_000);
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
  const partIds = new Set<string>();
  for (const event of events) {
    if (event.type !== "message") continue;
    for (const block of event.content) {
      if (block.type !== "data-chart" && block.type !== "data-document") {
        continue;
      }
      const id =
        block.id ??
        `${block.type === "data-chart" ? "chart" : "document"}-${artifacts.length + 1}`;
      if (partIds.has(id)) continue;
      partIds.add(id);
      artifacts.push(block);
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
  private readonly activeSessions = new Map<string, AgentSession>();
  private readonly activeCancellations = new Map<string, () => void>();
  private stopping = false;
  private readonly queued = new Set<string>();
  private readonly workspaceQueues = new Map<string, Promise<void>>();

  constructor(
    private readonly manager: SessionManager,
    private readonly onChange: (workspaceId: string) => void | Promise<void>,
    private readonly onNotice: (
      workspaceId: string,
      notice: RuntimeNotice,
    ) => void = () => undefined,
    private readonly prepareWorkspaceTools: (
      workspaceId: string,
    ) => Promise<ExecutorWorkspace | null> = () => Promise.resolve(null),
  ) {}

  /** Notices are best-effort; they must never break a run. */
  private notice(workspaceId: string, notice: RuntimeNotice) {
    try {
      this.onNotice(workspaceId, notice);
    } catch (error) {
      console.error("[scheduler] notice failed:", error);
    }
  }

  /**
   * Turn a missing required source into owned Setup work. The dependency job
   * has a stable id so repeated scheduler ticks cannot fan out duplicate setup
   * agents. A recent completed recovery is not immediately repeated; that
   * becomes one concrete attention item instead of an agent loop.
   */
  private async queueSetupRecovery(
    workspaceId: string,
    work: RecurringWorkRecord,
    requirement: SetupRequirement,
  ) {
    const id = `dependency-${work.id}`;
    const existing = await this.manager.recurringWorkById(workspaceId, id);
    const now = Date.now();
    if (
      existing?.status === "active" ||
      existing?.status === "needs_approval"
    ) {
      return { queued: true, setupWork: existing };
    }
    if (
      existing?.lastRunAt &&
      now - existing.lastRunAt < RECOVERY_COOLDOWN_MS
    ) {
      await this.manager.raiseAttentionItem(workspaceId, {
        id: `attention-${work.id}-dependency`,
        agentId: "setup",
        title: `Finish setup for ${work.title}`,
        reason: `${requirement.reason} Setup already tried recently and still needs your input. Open the setup run to continue without repeating the same work.`,
        sourceId: `automation-${id}`,
        status: "open",
        createdAt: now,
      });
      return { queued: false, setupWork: existing };
    }

    const providers =
      requirement.providers.length > 0
        ? requirement.providers.join(", ")
        : "the strongest relevant source available to this workspace";
    const toolPatterns = [
      "tools.search",
      "tools.executor.coreTools.connections.list",
      "tools.chief.org.workspace.agentTools.sourcesList",
      "tools.chief.org.workspace.agentTools.integrationsMarkConnected",
      "tools.chief-local.org.localworkspace.localTools.attentionRaise",
      "tools.chief-local.org.localworkspace.localTools.googleAnalyticsProperties",
      "tools.chief-local.org.localworkspace.localTools.googleAnalyticsMetadata",
      "tools.chief-local.org.localworkspace.localTools.googleAnalyticsRunReport",
    ];
    const setupWork: RecurringWorkRecord = {
      id,
      agentId: "setup",
      title: `Set up sources for ${work.title}`,
      instructions: [
        `Another Chief agent could not complete “${work.title}” because a required dependency is unavailable. Own the dependency and remove it rather than returning the problem to that agent.`,
        `Category: ${requirement.category}. Preferred providers: ${providers}.`,
        `Reason from the blocked work: ${requirement.reason}`,
        "Check connected sources, saved Chief environment values, existing machine credentials, installed CLIs, and public read-only alternatives first. Use integrations.sh as the source of truth for any provider setup. Install or configure everything you safely can. Request the smallest possible user consent or credential only when it is genuinely unavoidable.",
        "Verify a relevant source with a real read before declaring setup complete. Mark verified integrations connected in Chief. Do not treat a successful login with a failed data request as success.",
        'After a real verification succeeds, end with CHIEF_SETUP_RESULT {"provider":"canonical-provider-id","status":"connected","evidence":"one short description of the successful read"}. Chief resumes the original work only when that marker is present.',
        "If user input is required, emit one CHIEF_INPUT_REQUEST and stop so the app can collect it and retry this setup job.",
        `CHIEF_RESUME_WORK_ID ${work.id}`,
      ].join("\n\n"),
      cron: "0 0 1 1 *",
      timezone: work.timezone,
      runOnceAt: now,
      status: "active",
      placement: "local",
      approvalSummary: `Chief will prepare the missing ${requirement.category} access for ${work.title}, request only unavoidable input, then resume the original work.`,
      proposedToolPatterns: toolPatterns,
      grant: { version: 1, approvedAt: now, toolPatterns },
      nextRunAt: now,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    await this.manager.saveRecurringWork(workspaceId, setupWork);
    await this.manager.raiseAttentionItem(workspaceId, {
      id: `attention-${id}-recovery`,
      agentId: "setup",
      title: setupWork.title,
      reason:
        "Setup is checking existing access and preparing the missing source now. Open the run to follow its progress or provide consent if requested.",
      sourceId: `automation-${id}`,
      status: "open",
      createdAt: now,
    });
    await this.onChange(workspaceId);
    return { queued: true, setupWork };
  }

  async start() {
    if (this.timer) return;
    this.stopping = false;
    // Fire-and-forget: a failed tick logs and waits for the next interval
    // instead of surfacing an unhandled rejection that kills the runtime.
    const safeTick = () =>
      void this.tick().catch((error) =>
        console.error("[scheduler] tick failed:", error),
      );
    await this.manager.reconcileInterruptedRecurringWorkRuns(Date.now());
    safeTick();
    this.timer = setInterval(safeTick, POLL_INTERVAL_MS);
    this.timer.unref();
  }

  stop() {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async drain() {
    await Promise.allSettled(this.workspaceQueues.values());
  }

  async cancelActive() {
    for (const cancel of this.activeCancellations.values()) cancel();
    await Promise.allSettled(
      [...this.activeSessions.values()].map((session) => session.interrupt()),
    );
  }

  async runNow(workspaceId: string, recurringWorkId: string) {
    const work = await this.manager.recurringWorkById(
      workspaceId,
      recurringWorkId,
    );
    if (!work) throw new Error("Recurring work was not found.");
    if (!work.grant) throw new Error("Recurring work has not been approved.");
    await this.enqueue(workspaceId, work.id, () =>
      this.run(workspaceId, work, Date.now(), { claim: false }),
    );
  }

  async resumeAfterCurrent(workspaceId: string, recurringWorkId: string) {
    await this.workspaceQueues.get(workspaceId)?.catch(() => undefined);
    await this.runNow(workspaceId, recurringWorkId);
  }

  /**
   * Codex agents in one workspace share state and connector runtimes. Keep a
   * single ordered execution lane for every entry point (polling and Run now)
   * so first-launch migrations cannot race one another. Other workspaces still
   * run independently.
   */
  private enqueue(
    workspaceId: string,
    recurringWorkId: string,
    task: () => Promise<void>,
  ) {
    const key = `${workspaceId}:${recurringWorkId}`;
    if (this.queued.has(key)) return Promise.resolve();
    this.queued.add(key);
    const previous = this.workspaceQueues.get(workspaceId) ?? Promise.resolve();
    const current = previous
      .catch(() => undefined)
      .then(() => (this.stopping ? undefined : task()))
      .finally(() => {
        this.queued.delete(key);
        if (this.workspaceQueues.get(workspaceId) === current) {
          this.workspaceQueues.delete(workspaceId);
        }
      });
    this.workspaceQueues.set(workspaceId, current);
    return current;
  }

  private async tick() {
    const due = await this.manager.dueRecurringWork(Date.now());
    const byWorkspace = new Map<string, typeof due>();
    for (const work of due) {
      const workspaceWork = byWorkspace.get(work.workspaceId) ?? [];
      workspaceWork.push(work);
      byWorkspace.set(work.workspaceId, workspaceWork);
    }
    await Promise.all(
      [...byWorkspace.values()].flatMap((workspaceWork) =>
        workspaceWork
          .sort((a, b) => (a.nextRunAt ?? 0) - (b.nextRunAt ?? 0))
          .map((work) =>
            this.enqueue(work.workspaceId, work.id, () =>
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
    status: "completed" | "waiting" | "failed" | "needs_approval",
    runId: string,
    detail?: string,
  ) {
    try {
      const resolvedDetail = detail?.trim();
      if (session) {
        await this.manager.saveTranscript(
          {
            id: `automation-run-${runId}`,
            workspaceId,
            agentId: work.agentId,
            driver: session.config.driver,
          },
          session.events,
          work.title,
        );
      }
      const reconnecting =
        status === "waiting" &&
        resolvedDetail?.toLowerCase().includes("reconnect");
      const noticeTitle = reconnecting
        ? "Chief is reconnecting"
        : status === "waiting"
          ? "Setup is taking over"
          : status === "needs_approval" && work.agentId === "setup"
            ? "Setup needs your input"
            : work.title;
      const noticeDetail =
        status === "waiting" && !reconnecting && resolvedDetail
          ? `${work.title}: ${resolvedDetail}`
          : resolvedDetail;
      this.notice(workspaceId, {
        kind:
          status === "completed"
            ? "run-completed"
            : status === "waiting" ||
                (status === "needs_approval" && work.agentId === "setup")
              ? "setup-required"
              : status === "needs_approval"
                ? "run-blocked"
                : "run-failed",
        title: noticeTitle,
        detail: noticeDetail?.length ? noticeDetail.slice(0, 140) : undefined,
        sourceId: `automation-${work.id}`,
        agentId: work.agentId,
        chatId: `automation-run-${runId}`,
        runId,
        recurringWorkId: work.id,
      });
      if (status !== "completed" && status !== "waiting") {
        await this.manager.raiseAttentionItem(workspaceId, {
          id: `attention-${work.id}-${status}`,
          agentId: work.agentId,
          title: work.title,
          reason: resolvedDetail?.length
            ? resolvedDetail
            : status === "needs_approval"
              ? "The run stopped at an action outside its approved scope."
              : "The run failed.",
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
    // Execution providers are user configuration, never runtime defaults.
    // Resolve this before claiming an occurrence or preparing tools so a
    // missing local agent app cannot spend tokens or enter a retry loop.
    const agentConfig = await scheduledAgentConfig(
      this.manager,
      workspaceId,
      work,
    );
    if (!agentConfig) {
      await deferForAgentConfiguration(
        this.manager,
        workspaceId,
        work,
        (noticeWorkspaceId, notice) => this.notice(noticeWorkspaceId, notice),
        this.onChange,
      );
      return;
    }
    // Scheduled work must use the same freshly configured Executor surface as
    // interactive chat. If the desktop client has not authorized this
    // workspace yet, leave the occurrence due and try after it connects. Do
    // not claim a run or spend model tokens with a stale/missing tool catalog.
    const executor = await this.prepareWorkspaceTools(workspaceId).catch(
      (error: unknown) => {
        console.error(
          `[scheduler] workspace tools unavailable for ${work.id}:`,
          error,
        );
        return null;
      },
    );
    if (!executor) return;
    this.running.add(work.id);
    const now = Date.now();
    const recoveredAfterDowntime =
      claim && scheduledFor < now - POLL_INTERVAL_MS * 3;
    const isOnboardingWork = work.id.startsWith("onboarding-");
    // Downtime recovery is one catch-up run, not a replay: the next
    // occurrence is computed from now when the due time is already past,
    // otherwise a week offline would refire a daily job seven times.
    const scheduleFrom = () => Math.max(scheduledFor, Date.now());
    const followingRunAt =
      work.runOnceAt === undefined
        ? nextRunAt(work.cron, work.timezone, scheduleFrom())
        : null;
    if (
      claim &&
      work.skipDates?.includes(runDateKey(scheduledFor, work.timezone))
    ) {
      // Scheduled dispatch must win an atomic claim on the due time so a
      // second runtime polling the same database cannot run the same job.
      const claimed = await this.manager.claimRecurringWork(
        workspaceId,
        work.id,
        scheduledFor,
        followingRunAt,
      );
      if (!claimed) {
        this.running.delete(work.id);
        return;
      }
      const skipKey = runDateKey(scheduledFor, work.timezone);
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
    const isSetupWork =
      work.runOnceAt !== undefined &&
      (work.agentId === "setup" || work.agentId === "brand");

    let session: AgentSession | null = null;
    let beforeData: Awaited<
      ReturnType<SessionManager["workspaceData"]>
    > | null = null;
    let started = false;
    let terminalSaved = false;
    let terminalPersistenceStarted = false;
    let postProcessingStarted = false;
    let blocked = false;
    const blockedTools: string[] = [];
    try {
      // The database unique index is the cross-process lease. A stale dev
      // runtime, an installed app, or a repeated Run now message can all reach
      // this point, but only one may create the live attempt. Historical runs
      // remain untouched and reviewable.
      const claimedAndStarted = await this.manager.startRecurringWorkRun(
        workspaceId,
        run,
        {
          expectedNextRunAt: claim ? scheduledFor : undefined,
          nextRunAt: followingRunAt,
        },
      );
      if (!claimedAndStarted) return;
      started = true;
      beforeData = await this.manager.workspaceData(workspaceId);
      await this.onChange(workspaceId);
      // Initial onboarding work is intentionally banked before the dashboard
      // opens. Its in-progress action card is enough feedback; an offline
      // recovery toast here incorrectly frames expected setup as an error.
      if (!isOnboardingWork) {
        this.notice(workspaceId, {
          kind: "run-started",
          title: work.title,
          detail: recoveredAfterDowntime
            ? "This was due while Chief was offline. It is starting now."
            : "Your agent is working on this now.",
          sourceId: `automation-${work.id}`,
          agentId: work.agentId,
          chatId: `automation-run-${run.id}`,
          runId: run.id,
          recurringWorkId: work.id,
        });
      }
      const { agent, preference } = agentConfig;

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
              "tools.chief-local.org.localworkspace.localTools.googleAnalyticsProperties",
              "tools.chief-local.org.localworkspace.localTools.googleAnalyticsMetadata",
              "tools.chief-local.org.localworkspace.localTools.googleAnalyticsRunReport",
            ]),
          ]
        : approved;
      const unattendedAccessRules = isSetupWork
        ? "This is approved setup work. Work proactively and use the local shell, browser, native web research, existing machine credentials, and Executor when they help complete it. Never expose secrets. Ask for browser consent, an account choice, or a missing credential only when it genuinely requires the user."
        : "This is an unattended recurring run that the user approved in Chief. Use Executor only; do not use shell commands or edit files.";
      const scheduledAgent = {
        ...agent,
        instructions: composeWorkspaceInstructions(
          `${agent.instructions}\n\n${unattendedAccessRules} You may call only these exact delegated Executor tool addresses: ${effectiveApproved.length > 0 ? effectiveApproved.join(", ") : "read-only tools that Executor already allows"}. Do not substitute a similarly named tool from another integration.${liveGoogleAnalyticsApproved ? " The live local Google Analytics report tool is approved. Always call tools.chief-local.org.localworkspace.localTools.googleAnalyticsRunReport for Google Analytics, even when an older task instruction names tools.chief.org.workspace.agentTools.analyticsRunReport or the workspace source says cached. The cached source is discovery metadata, not the report to analyze. Call the local report tool with body: { propertyId, startDate, endDate, metrics: [string], dimensions: [string], limit }. Never use dateRanges or objects with a name property." : ""} Read-only native web search is available and does not need an Executor grant. Use it for current public evidence and first-party pages before declaring a connector necessary. If the task needs any other mutation, use the structured setup dependency contract instead of returning a dead-end failure. Produce a decision-ready result, not only prose. Do not optimize for the fastest possible answer. Research, verify, and save substantive work. For content, every contentSave body must be the complete platform-native copy, not an angle, outline, or description. Present numeric time series as focused charts. Multiple charts are encouraged when the evidence covers different questions. Each chart must contain only directly comparable series, use one measurement scale, and order time points chronologically. Never combine daily traffic, acquisition groups, landing pages, and events into one chart. Make created or updated campaigns, prospects, signals, and content explicit so Chief can show them as reviewable artifacts. Put concise analysis beside the artifact. Never publish connector errors, tool names, authorization details, missing-data complaints, or debugging instructions as a report. Retry once only when an approved tool reports a transient provider or network error. Never repeat a declined or blocked call. If a required source is still the only blocker after exhausting safe alternatives, return only one CHIEF_SETUP_REQUIRED JSON line using the contract in the operating rules. Use direct sales-style language and never use an em dash character.`,
          readWorkspaceContext(workspaceId),
        ),
      };
      session = await this.manager.ensure(
        scheduledAgent,
        `automation-run-${run.id}`,
        {
          driver: preference.driver,
          // Setup work is explicitly selected during onboarding. It needs
          // local browser, credential and shell access to complete OAuth and
          // machine setup rather than immediately declining those actions.
          // Executor still enforces the automation's narrow tool grant.
          access: isSetupWork ? "full" : "guarded",
          workspaceId,
          model: preference?.model,
          mcpServers: [executorToolServer(executor)],
          automationGrant: {
            ...work.grant,
            // The legacy analytics grant is deliberately expanded above to
            // the three read-only local GA helpers. Pass that effective grant
            // to the approval handler as well as the prompt, otherwise the
            // correctly selected helper is still declined at execution time.
            toolPatterns: effectiveApproved,
          },
        },
      );
      this.activeSessions.set(work.id, session);

      const result = await new Promise<{ ok: boolean; error?: string }>(
        async (resolve, reject) => {
          const timeout = setTimeout(
            () => reject(new Error("Recurring work timed out.")),
            10 * 60_000,
          );
          timeout.unref();
          this.activeCancellations.set(work.id, () => {
            clearTimeout(timeout);
            resolve({
              ok: false,
              error: "Chief closed before this run returned a result.",
            });
          });
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
            if (event.type === "exit") {
              clearTimeout(timeout);
              resolve({
                ok: false,
                error:
                  "The local agent service exited before returning a result.",
              });
            }
          });
          try {
            await session!.sendPrompt(
              `Run this approved recurring work now.\n\n${work.instructions}\n\nReturn a concise result with a clear headline, the evidence, the next action, what was saved or sent, and anything that needs the user's attention. Use bullets where they improve scanning. Do not use an em dash character.`,
            );
          } catch (error) {
            clearTimeout(timeout);
            reject(error);
          }
        },
      );

      // SessionManager persists every durable event in one ordered per-chat
      // chain. Wait for the terminal event instead of writing the same
      // transcript through a second concurrent path, which can hold libSQL's
      // transaction open and lock the workspace snapshot behind SQLITE_BUSY.
      await this.manager.waitForChatPersistence(`automation-run-${run.id}`);

      const agentSummary = lastAssistantText(session.events);
      if (!result.ok && result.error && isTransientRuntimeError(result.error)) {
        throw new Error(result.error);
      }
      postProcessingStarted = true;
      const blockedWorkId = resumeWorkId(work.instructions);
      const dependencyVerified =
        !blockedWorkId || setupResultConnected(agentSummary);
      let inputNeeded = requestedInputSummary(agentSummary);
      const dataFailure = reportedRequiredDataFailure(
        agentSummary,
        liveGoogleAnalyticsApproved || work.agentId === "analyst",
      );
      let setupRequirement =
        work.agentId === "setup"
          ? null
          : requestedSetupRequirement(agentSummary, work, dataFailure);
      const contextRequest = !inputNeeded
        ? workspaceContextRequest(setupRequirement, work)
        : null;
      if (contextRequest) {
        const authorizedRequest = authorizeContextRequest(
          workspaceId,
          work.id,
          contextRequest,
        );
        session.events.push({
          type: "message",
          role: "assistant",
          content: [
            {
              type: "text",
              text: `CHIEF_INPUT_REQUEST ${JSON.stringify(authorizedRequest)}`,
            },
          ],
        });
        inputNeeded = `${contextRequest.title}. Answer the question to continue.`;
        setupRequirement = null;
      }
      const recovery =
        !blocked && !inputNeeded && setupRequirement
          ? await this.queueSetupRecovery(workspaceId, work, setupRequirement)
          : null;
      const artifacts = await this.manager
        .workspaceData(workspaceId)
        .then((afterData) =>
          artifactsFromRun(session!.events, beforeData!, afterData),
        )
        .catch(() => []);
      const status: RecurringWorkRunRecord["status"] =
        blocked || inputNeeded
          ? "needs_approval"
          : recovery?.queued
            ? "waiting"
            : setupRequirement
              ? "needs_approval"
              : result.ok && !dataFailure && dependencyVerified
                ? "completed"
                : blockedWorkId && result.ok
                  ? "needs_approval"
                  : "failed";
      const summary = blocked
        ? blockedRunSummary(blockedTools)
        : inputNeeded
          ? inputNeeded
          : recovery?.queued
            ? `Setup is preparing the missing ${setupRequirement?.category ?? "source"} access now. Chief will resume this work automatically after the connection is verified.`
            : setupRequirement
              ? `Setup still needs your input before ${work.title} can continue.`
              : blockedWorkId && result.ok && !dependencyVerified
                ? `Setup could not verify the missing source yet. The original work was not restarted.`
                : dataFailure
                  ? `${dataFailure} Nothing was changed.`
                  : agentSummary;
      const finishedAt = Date.now();
      const finishedWork: RecurringWorkRecord = {
        ...work,
        status:
          status === "needs_approval" || status === "waiting"
            ? "needs_approval"
            : work.runOnceAt === undefined
              ? "active"
              : "paused",
        nextRunAt:
          status === "needs_approval" || status === "waiting"
            ? undefined
            : work.runOnceAt === undefined
              ? nextRunAt(work.cron, work.timezone, scheduleFrom())
              : undefined,
        lastRunAt: finishedAt,
        lastResult: summary ?? result.error,
        updatedAt: finishedAt,
      };
      terminalPersistenceStarted = true;
      await this.manager.finishRecurringWorkRun(
        workspaceId,
        {
          ...run,
          status,
          finishedAt,
          summary,
          artifacts: artifacts.length > 0 ? artifacts : undefined,
          error: result.error,
          blockedTools: blockedTools.length > 0 ? blockedTools : undefined,
        },
        finishedWork,
      );
      terminalSaved = true;
      // A setup dependency starts with one progress attention item. Once the
      // agent genuinely pauses for input, replace that progress state with the
      // actionable needs-approval item instead of showing both cards.
      if (inputNeeded) {
        await this.manager.dismissAttentionItem(
          workspaceId,
          `attention-${work.id}-recovery`,
        );
      }
      // Every run leaves a reviewable transcript, and a blocked run raises
      // one concrete attention item instead of failing silently.
      await this.deliverRunOutcome(
        workspaceId,
        work,
        session,
        status,
        run.id,
        summary,
      );
      if (work.id.startsWith("onboarding-")) {
        await this.manager.dismissAttentionItem(
          workspaceId,
          `attention-${work.id}-onboarding`,
        );
      }
      if (status === "completed") {
        for (const suffix of [
          "approval",
          "needs_approval",
          "failed",
          "dependency",
          "recovery",
        ]) {
          await this.manager.dismissAttentionItem(
            workspaceId,
            `attention-${work.id}-${suffix}`,
          );
        }
      }
      if (status === "completed" && blockedWorkId) {
        const blockedWork = await this.manager.recurringWorkById(
          workspaceId,
          blockedWorkId,
        );
        if (blockedWork?.grant) {
          await this.manager.saveRecurringWork(workspaceId, {
            ...blockedWork,
            status: "active",
            nextRunAt: Date.now(),
            updatedAt: Date.now(),
          });
          await this.manager.dismissAttentionItem(
            workspaceId,
            `attention-${work.id}-recovery`,
          );
          await this.manager.dismissAttentionItem(
            workspaceId,
            `attention-${blockedWorkId}-dependency`,
          );
        }
      }
    } catch (error) {
      console.error(`[scheduler] run ${work.id} failed:`, error);
      if (terminalSaved || !started) return;
      if (terminalPersistenceStarted || postProcessingStarted) {
        const message =
          "Chief finished this run but could not save its final state. It will not retry automatically.";
        const finishedAt = Date.now();
        await this.manager
          .finishRecurringWorkRun(
            workspaceId,
            {
              ...run,
              status: "failed",
              finishedAt,
              error: message,
            },
            {
              ...work,
              status: "needs_approval",
              nextRunAt: undefined,
              lastRunAt: finishedAt,
              lastResult: message,
              updatedAt: finishedAt,
            },
          )
          .catch((saveError) =>
            console.error(
              "[scheduler] could not preserve the terminal run state:",
              saveError,
            ),
          );
        return;
      }
      const retry = transientRetryOutcome(error, work);
      const retrying =
        retry.retrying && !hasPotentialSideEffects(session?.events ?? []);
      const message =
        retry.retrying && !retrying
          ? "Chief stopped after a local runtime issue, but the run had already used tools. It will not retry automatically."
          : (retry.message ?? safeRunFailure(error));
      const baseline = beforeData;
      const artifacts =
        session && baseline
          ? await this.manager
              .workspaceData(workspaceId)
              .then((afterData) =>
                artifactsFromRun(session!.events, baseline, afterData),
              )
              .catch(() => [])
          : [];
      const finishedAt = Date.now();
      const failedStatus = blocked
        ? "needs_approval"
        : retrying
          ? "waiting"
          : "failed";
      await this.manager.finishRecurringWorkRun(
        workspaceId,
        {
          ...run,
          status: failedStatus,
          finishedAt,
          error: message,
          artifacts: artifacts.length > 0 ? artifacts : undefined,
        },
        {
          ...work,
          status: blocked
            ? "needs_approval"
            : retrying
              ? "active"
              : work.runOnceAt === undefined
                ? "active"
                : "error",
          nextRunAt: blocked
            ? work.nextRunAt
            : retrying
              ? finishedAt + TRANSIENT_RETRY_DELAY_MS
              : work.runOnceAt === undefined
                ? nextRunAt(work.cron, work.timezone, scheduleFrom())
                : undefined,
          lastRunAt: finishedAt,
          lastResult: message,
          updatedAt: finishedAt,
        },
      );
      if (session) {
        await this.manager.waitForChatPersistence(`automation-run-${run.id}`);
        await this.manager
          .saveTranscript(
            {
              id: `automation-run-${run.id}`,
              workspaceId,
              agentId: work.agentId,
              driver: session.config.driver,
            },
            session.events,
            work.title,
          )
          .catch((transcriptError) =>
            console.error(
              "[scheduler] could not preserve failed run transcript:",
              transcriptError,
            ),
          );
      }
      await this.deliverRunOutcome(
        workspaceId,
        work,
        session,
        blocked ? "needs_approval" : retrying ? "waiting" : "failed",
        run.id,
        message,
      );
      if (work.id.startsWith("onboarding-")) {
        await this.manager.dismissAttentionItem(
          workspaceId,
          `attention-${work.id}-onboarding`,
        );
      }
    } finally {
      this.running.delete(work.id);
      this.activeSessions.delete(work.id);
      this.activeCancellations.delete(work.id);
      await session
        ?.stop()
        .catch((stopError) =>
          console.error("[scheduler] could not stop run session:", stopError),
        );
      await Promise.resolve(this.onChange(workspaceId)).catch((changeError) =>
        console.error("[scheduler] could not publish run state:", changeError),
      );
    }
  }
}
