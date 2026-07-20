/* eslint-disable max-lines -- The scheduler owns the complete occurrence lifecycle. */

import { randomUUID } from "node:crypto";

import type { SessionManager } from "./manager.js";
import type { AgentSession } from "./session.js";
import type { ExecutorWorkspace } from "./tools/control-plane.js";
import type {
  ActionItem,
  AgentEvent,
  DriverType,
  InputRequest,
  RecurringWorkRecord,
  RuntimeNotice,
  SessionArtifact,
  SessionRecord,
} from "./types.js";
import { composeWorkspaceInstructions } from "./agents.js";
import {
  DEPLOYMENT_REQUIRED_MESSAGE,
  isDeploymentNotFound,
} from "./deployment-failure.js";
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
import { workspaceKey } from "./workspace-secrets.js";

const POLL_INTERVAL_MS = 5_000;

function deploymentActionId(workspaceId: string) {
  return `action-chief-deployment-required-${workspaceKey(workspaceId)}`;
}

interface SourceRequirement {
  category: "analytics" | "ads" | "social" | "research" | "other";
  providers: string[];
  reason: string;
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

function requestedInput(summary: string | undefined): InputRequest | null {
  const line = summary
    ?.split("\n")
    .find((candidate) => candidate.trim().startsWith("CHIEF_INPUT_REQUEST "));
  if (!line) return null;
  try {
    const request = JSON.parse(
      line.trim().slice("CHIEF_INPUT_REQUEST ".length),
    ) as Partial<InputRequest>;
    if (
      typeof request.id !== "string" ||
      typeof request.title !== "string" ||
      !Array.isArray(request.fields)
    ) {
      return null;
    }
    return request as InputRequest;
  } catch {
    return null;
  }
}

function requestedSourceRequirement(
  summary: string | undefined,
  work: RecurringWorkRecord,
  fallbackReason?: string | null,
): SourceRequirement | null {
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
        ? (parsed.category as SourceRequirement["category"])
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
      // Fall through to the agent-specific source description below.
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

function reportedRequiredDataFailure(
  summary: string | undefined,
  analyticsRequired: boolean,
) {
  if (!summary) return null;
  const marker = /(?:CHIEF|MARKETER)_(?:WORK|RUN)_FAILED\s*:?[ \t]*(.+)?/i.exec(
    summary,
  );
  if (marker) {
    const cause = marker[1]?.trim();
    return cause?.length ? cause : "The required source could not be read.";
  }
  if (/tool_not_found/i.test(summary)) {
    return "The required connector was not available to this work.";
  }
  if (
    analyticsRequired &&
    /live analytics report unavailable|analytics (?:data|report) (?:is |was )?(?:not available|unavailable)|analytics (?:has|have) not (?:yet )?populated|no reliable .*data .*available/i.test(
      summary,
    )
  ) {
    return "Google Analytics could not be read for this work.";
  }
  return null;
}

function blockedWorkSummary(blockedTools: readonly string[]) {
  if (
    blockedTools.some((tool) =>
      tool.startsWith("tools.google_analytics.org.main."),
    )
  ) {
    return "Live analytics was not read. The Analyst selected the cached workspace report path instead of this task's approved live Google Analytics path. No Google permission was removed and nothing was changed. Reconnect Google Analytics if prompted, then try the report again.";
  }
  const count = blockedTools.length;
  if (count === 0) {
    return "The connector stopped before the approved tool could be used. Nothing was changed. Try the task again; if it stops again, reconnect the integration.";
  }
  return count === 1
    ? "The work stopped before using one tool outside its approved scope. Nothing was changed. Review that tool, then try again."
    : `The work stopped before using ${count} tools outside its approved scope. Nothing was changed. Review those tools, then try again.`;
}

function safeWorkFailure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (/Failed query:|insert into|update .+ set|SQLITE_/i.test(message)) {
    return "Chief could not save this work cleanly. Nothing external was changed.";
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

function artifactsFromSession(
  events: readonly AgentEvent[],
  before: ArtifactWorkspaceData,
  after: ArtifactWorkspaceData,
): SessionArtifact[] {
  const artifacts: SessionArtifact[] = [];
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

type TerminalSessionStatus = Extract<
  SessionRecord["status"],
  "completed" | "failed" | "needs_approval"
>;

type OutcomeAction = ActionItem;

function staleOutcomeActionIds(workId: string) {
  return ["blocked", "failed", "required-source"].map(
    (suffix) => `action-${workId}-${suffix}`,
  );
}

function sessionDriver(session: SessionRecord, fallback: DriverType) {
  return session.attempt > 1 &&
    ["claude", "codex", "opencode"].includes(session.provider)
    ? (session.provider as DriverType)
    : fallback;
}

export class RecurringWorkScheduler {
  private timer: NodeJS.Timeout | null = null;
  private readonly activeWork = new Set<string>();
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

  /** Notices are best-effort; they must never break scheduled work. */
  private notice(workspaceId: string, notice: RuntimeNotice) {
    try {
      this.onNotice(workspaceId, notice);
    } catch (error) {
      console.error("[scheduler] notice failed:", error);
    }
  }

  async start() {
    if (this.timer) return;
    this.stopping = false;
    const safeTick = () =>
      void this.tick().catch((error) =>
        console.error("[scheduler] tick failed:", error),
      );
    await this.manager.reconcileInterruptedScheduleSessions(Date.now());
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
      this.execute(workspaceId, work, Date.now(), { claim: false }),
    );
  }

  async resumeAfterCurrent(workspaceId: string, recurringWorkId: string) {
    await this.workspaceQueues.get(workspaceId)?.catch(() => undefined);
    await this.runNow(workspaceId, recurringWorkId);
  }

  /** Keep one ordered execution lane because workspace tools share state. */
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
      const workspaceWork = byWorkspace.get(work.organizationId) ?? [];
      workspaceWork.push(work);
      byWorkspace.set(work.organizationId, workspaceWork);
    }
    await Promise.all(
      [...byWorkspace.values()].flatMap((workspaceWork) =>
        workspaceWork
          .sort((a, b) => (a.nextAt ?? 0) - (b.nextAt ?? 0))
          .map((work) =>
            this.enqueue(work.organizationId, work.id, () =>
              this.execute(
                work.organizationId,
                {
                  ...work,
                  conversationId: work.conversationId ?? undefined,
                  grant: work.grant ?? undefined,
                  skipDates: work.skipDates ?? undefined,
                  onceAt: work.onceAt ?? undefined,
                  nextAt: work.nextAt ?? undefined,
                  lastCompletedAt: work.lastCompletedAt ?? undefined,
                  lastSummary: work.lastSummary ?? undefined,
                },
                work.nextAt!,
                { claim: true },
              ).catch((error) =>
                console.error(`[scheduler] work ${work.id} failed:`, error),
              ),
            ),
          ),
      ),
    );
  }

  private deliverOutcome(
    workspaceId: string,
    work: RecurringWorkRecord,
    status: TerminalSessionStatus,
    sessionId: string,
    detail?: string,
    action?: OutcomeAction,
  ) {
    try {
      const resolvedDetail = detail?.trim();
      this.notice(workspaceId, {
        kind: action
          ? "action"
          : status === "completed"
            ? "work-completed"
            : status === "needs_approval"
              ? "work-blocked"
              : "work-failed",
        title: action?.title ?? work.title,
        detail: (action?.reason ?? resolvedDetail)?.slice(0, 140),
        sourceId: sessionId,
        agentId: "cmo",
        sessionId,
        recurringWorkId: work.id,
      });
    } catch (error) {
      console.error("[scheduler] could not deliver work outcome:", error);
    }
  }

  private async execute(
    workspaceId: string,
    work: RecurringWorkRecord,
    scheduledFor: number,
    { claim }: { claim: boolean },
  ) {
    const workKey = `${workspaceId}:${work.id}`;
    if (this.activeWork.has(workKey) || !work.grant) return;

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

    this.activeWork.add(workKey);
    const startedAt = Date.now();
    const scheduleFrom = Math.max(scheduledFor, startedAt);
    const followingAt =
      work.onceAt === undefined
        ? nextRunAt(work.cron, work.timezone, scheduleFrom)
        : null;
    const claimedNextAt = claim ? (followingAt ?? undefined) : work.nextAt;
    const { agent, preference } = agentConfig;
    let occurrence: SessionRecord = {
      id: randomUUID(),
      parentId: work.conversationId,
      scheduleId: work.id,
      kind: "task",
      visibility: "private",
      agent: "cmo",
      title: work.title,
      provider: preference.driver,
      model: preference.model,
      status: "running",
      scheduledFor,
      startedAt,
      attempt: 1,
      createdAt: startedAt,
      updatedAt: startedAt,
    };

    let runtimeSession: AgentSession | null = null;
    let releaseExecution: (() => void) | null = null;
    let beforeData: ArtifactWorkspaceData | null = null;
    let occurrenceStarted = false;
    let terminalSaved = false;
    let terminalPersistenceStarted = false;
    let postProcessingStarted = false;
    let blocked = false;
    let sessionStartIndex = 0;
    const blockedTools: string[] = [];

    try {
      const resumeExpectedAt = claim ? scheduledFor : work.nextAt;
      if (resumeExpectedAt !== undefined) {
        const resumed = await this.manager.resumeScheduleSession(
          workspaceId,
          work.id,
          {
            expectedNextAt: resumeExpectedAt,
            nextAt: followingAt,
            startedAt,
          },
        );
        if (resumed) {
          occurrence = resumed;
          occurrenceStarted = true;
        }
      }
      if (!occurrenceStarted) {
        occurrenceStarted = await this.manager.startScheduleSession(
          workspaceId,
          occurrence,
          claim
            ? {
                expectedNextAt: scheduledFor,
                nextAt: followingAt,
              }
            : undefined,
        );
      }
      if (!occurrenceStarted) return;

      if (work.skipDates?.includes(runDateKey(scheduledFor, work.timezone))) {
        const finishedAt = Date.now();
        const summary = "This scheduled occurrence was skipped.";
        terminalPersistenceStarted = true;
        await this.manager.finishScheduleSession(
          workspaceId,
          {
            ...occurrence,
            status: "completed",
            finishedAt,
            summary,
            updatedAt: finishedAt,
          },
          {
            ...work,
            status: work.onceAt === undefined ? work.status : "paused",
            skipDates: work.skipDates.filter(
              (date) => date !== runDateKey(scheduledFor, work.timezone),
            ),
            nextAt: claimedNextAt,
            updatedAt: finishedAt,
          },
          { dismissIds: staleOutcomeActionIds(work.id) },
        );
        terminalSaved = true;
        return;
      }

      releaseExecution = this.manager.acquireExecution(
        workspaceId,
        occurrence.id,
        "schedule",
      );
      beforeData = await this.manager.workspaceData(workspaceId);
      await this.onChange(workspaceId);
      this.notice(workspaceId, {
        kind: "work-started",
        title: work.title,
        detail:
          scheduledFor < startedAt - POLL_INTERVAL_MS * 3
            ? "This was due while Chief was offline. It is starting now."
            : "Chief is working on this now.",
        sourceId: occurrence.id,
        agentId: "cmo",
        sessionId: occurrence.id,
        recurringWorkId: work.id,
      });

      const approved = work.grant.toolPatterns.map(canonicalExecutorAddress);
      const liveGoogleAnalyticsApproved = approved.includes(
        "tools.google_analytics.org.main.*",
      );
      const effectiveApproved = approved;
      const scheduledAgent = {
        ...agent,
        instructions: composeWorkspaceInstructions(
          [
            agent.instructions,
            "This is unattended recurring work approved in Chief. Use Executor only; do not use shell commands or edit files.",
            `You may call only these exact delegated Executor tool addresses: ${effectiveApproved.length > 0 ? effectiveApproved.join(", ") : "read-only tools that Executor already allows"}. Do not substitute similarly named tools from another integration.`,
            liveGoogleAnalyticsApproved
              ? "For live Google Analytics, search within tools.google_analytics.org.main and choose the narrowest suitable live operation. The integration exposes standard, realtime, pivot, batch, metadata and compatibility methods for dynamic analysis. Cached source metadata is not the report to analyze."
              : "",
            "Native read-only web search is available for current public evidence and first-party pages.",
            "If required data or an integration is unavailable, explain the single concrete action the user must take. Do not create setup work, dependency work, or automatic recovery instructions.",
            "Produce a decision-ready result. Research, verify, and save substantive work. Make created or updated campaigns, prospects, signals, and content explicit as reviewable artifacts.",
            "For content, save complete platform-native copy rather than an angle or outline. Present numeric time series as focused charts with comparable series, one scale, and chronological points.",
            "Never expose connector errors, internal tool names, credentials, or implementation details in the user-facing answer.",
          ]
            .filter(Boolean)
            .join("\n\n"),
          readWorkspaceContext(workspaceId),
        ),
      };
      const executionDriver = sessionDriver(occurrence, preference.driver);
      runtimeSession = await this.manager.ensureTaskSession(
        scheduledAgent,
        occurrence.parentId,
        occurrence.id,
        {
          driver: executionDriver,
          access: "guarded",
          workspaceId,
          model: occurrence.attempt > 1 ? occurrence.model : preference.model,
          mcpServers: [executorToolServer(executor)],
          automationGrant: {
            ...work.grant,
            toolPatterns: effectiveApproved,
          },
          executionOwner: "schedule",
        },
        work.title,
      );
      sessionStartIndex = runtimeSession.events.length;
      this.activeSessions.set(occurrence.id, runtimeSession);

      const result = await new Promise<{ ok: boolean; error?: string }>(
        (resolve, reject) => {
          const timeout = setTimeout(
            () => reject(new Error("Scheduled work timed out.")),
            10 * 60_000,
          );
          timeout.unref();
          this.activeCancellations.set(occurrence.id, () => {
            clearTimeout(timeout);
            resolve({
              ok: false,
              error: "Chief closed before this work returned a result.",
            });
          });
          runtimeSession!.on("event", (event: AgentEvent) => {
            if (
              event.type === "permission" &&
              event.toolName.startsWith("tools.") &&
              !blockedTools.includes(event.toolName)
            ) {
              blocked = true;
              blockedTools.push(event.toolName);
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
          void runtimeSession!
            .sendPrompt(
              `Complete this approved recurring work as the CMO. The specialist hint is ${work.agentId}; delegate privately if useful, but own all final changes and the answer.\n\n${work.instructions}\n\nReturn a concise result with a clear headline, evidence, the next action, what was saved or sent, and anything needing the user's attention. Use bullets where they improve scanning. Do not use an em dash character.`,
            )
            .catch((error) => {
              clearTimeout(timeout);
              reject(error);
            });
        },
      );

      await this.manager.waitForChatPersistence(workspaceId, occurrence.id);
      const sessionEvents = runtimeSession.events.slice(sessionStartIndex);
      const agentSummary = lastAssistantText(sessionEvents);
      if (!result.ok && result.error && isTransientRuntimeError(result.error)) {
        throw new Error(result.error);
      }

      postProcessingStarted = true;
      const inputRequest = requestedInput(agentSummary);
      if (inputRequest?.fields.some((field) => "contextKey" in field.save)) {
        runtimeSession.recordAssistantMessage(
          `CHIEF_INPUT_REQUEST ${JSON.stringify(
            authorizeContextRequest(workspaceId, work.id, inputRequest),
          )}`,
        );
        await this.manager.waitForChatPersistence(workspaceId, occurrence.id);
      }
      const dataFailure = reportedRequiredDataFailure(
        agentSummary,
        liveGoogleAnalyticsApproved || work.agentId === "analyst",
      );
      const sourceRequirement = inputRequest
        ? null
        : requestedSourceRequirement(agentSummary, work, dataFailure);
      const latestBlockedTools = blocked
        ? [
            ...new Set([
              ...(await this.manager.latestSessionBlockedTools(
                workspaceId,
                work.id,
              )),
              ...blockedTools,
            ]),
          ]
        : blockedTools;
      const artifacts = await this.manager
        .workspaceData(workspaceId)
        .then((afterData) =>
          artifactsFromSession(sessionEvents, beforeData!, afterData),
        )
        .catch(() => []);
      const deploymentMissing =
        !result.ok && isDeploymentNotFound(result.error);
      const status: TerminalSessionStatus =
        deploymentMissing || blocked || inputRequest || sourceRequirement
          ? "needs_approval"
          : result.ok && !dataFailure
            ? "completed"
            : "failed";
      const summary = deploymentMissing
        ? DEPLOYMENT_REQUIRED_MESSAGE
        : blocked
          ? blockedWorkSummary(latestBlockedTools)
          : inputRequest
            ? `${inputRequest.title}. Complete the requested fields to continue.`
            : sourceRequirement
              ? sourceRequirement.reason
              : dataFailure
                ? `${dataFailure} Nothing was changed.`
                : (agentSummary ?? result.error);
      const finishedAt = Date.now();
      const finishedWork: RecurringWorkRecord = {
        ...work,
        status:
          status === "needs_approval"
            ? "needs_approval"
            : status === "completed"
              ? work.onceAt === undefined
                ? "active"
                : "paused"
              : work.onceAt === undefined
                ? "active"
                : "error",
        nextAt: status === "needs_approval" ? undefined : claimedNextAt,
        lastCompletedAt:
          status === "completed" ? finishedAt : work.lastCompletedAt,
        lastSummary: summary,
        updatedAt: finishedAt,
      };
      const action: OutcomeAction | undefined = deploymentMissing
        ? {
            id: deploymentActionId(workspaceId),
            agentId: "cmo",
            title: "Connect Chief",
            reason: DEPLOYMENT_REQUIRED_MESSAGE,
            sourceId: occurrence.id,
            status: "open",
            createdAt: finishedAt,
          }
        : blocked
          ? {
              id: `action-${work.id}-blocked`,
              agentId: "cmo",
              title: `Review access for ${work.title}`,
              reason: summary ?? "The task needs approval to continue.",
              sourceId: occurrence.id,
              status: "open",
              createdAt: finishedAt,
            }
          : inputRequest
            ? {
                id: `action-${occurrence.id}-input`,
                agentId: "cmo",
                title: inputRequest.title,
                reason:
                  inputRequest.reason ??
                  "Complete the requested fields to continue this task.",
                sourceId: occurrence.id,
                status: "open",
                createdAt: finishedAt,
              }
            : sourceRequirement
              ? {
                  id: `action-${work.id}-required-source`,
                  agentId: "cmo",
                  title: `Connect a source for ${work.title}`,
                  reason: sourceRequirement.reason,
                  sourceId: occurrence.id,
                  status: "open",
                  createdAt: finishedAt,
                }
              : status === "failed"
                ? {
                    id: `action-${work.id}-failed`,
                    agentId: "cmo",
                    title: work.title,
                    reason: summary ?? "The task failed.",
                    sourceId: occurrence.id,
                    status: "open",
                    createdAt: finishedAt,
                  }
                : undefined;
      const staleActionIds = staleOutcomeActionIds(work.id).filter(
        (id) => id !== action?.id,
      );
      terminalPersistenceStarted = true;
      await this.manager.finishScheduleSession(
        workspaceId,
        {
          ...occurrence,
          status,
          finishedAt,
          summary,
          artifacts: artifacts.length > 0 ? artifacts : undefined,
          error:
            status === "failed"
              ? result.error
              : deploymentMissing
                ? DEPLOYMENT_REQUIRED_MESSAGE
                : undefined,
          blockedTools:
            latestBlockedTools.length > 0 ? latestBlockedTools : undefined,
          updatedAt: finishedAt,
        },
        finishedWork,
        {
          upsert: action,
          dismissIds: staleActionIds,
        },
      );
      terminalSaved = true;
      this.deliverOutcome(
        workspaceId,
        work,
        status,
        occurrence.id,
        summary,
        action,
      );
    } catch (error) {
      console.error(`[scheduler] work ${work.id} failed:`, error);
      if (terminalSaved || !occurrenceStarted) return;

      if (terminalPersistenceStarted || postProcessingStarted) {
        const message =
          "Chief finished this work but could not save its final state. It will not retry automatically.";
        const finishedAt = Date.now();
        const action: ActionItem = {
          id: `action-${work.id}-failed`,
          agentId: "cmo",
          title: work.title,
          reason: message,
          sourceId: occurrence.id,
          status: "open",
          createdAt: finishedAt,
        };
        await this.manager
          .finishScheduleSession(
            workspaceId,
            {
              ...occurrence,
              status: "failed",
              finishedAt,
              error: message,
              updatedAt: finishedAt,
            },
            {
              ...work,
              status: "needs_approval",
              nextAt: undefined,
              lastSummary: message,
              updatedAt: finishedAt,
            },
            {
              upsert: action,
              dismissIds: staleOutcomeActionIds(work.id).filter(
                (id) => id !== action.id,
              ),
            },
          )
          .catch((saveError) =>
            console.error(
              "[scheduler] could not preserve the terminal session state:",
              saveError,
            ),
          );
        return;
      }

      const deploymentMissing = isDeploymentNotFound(error);
      const retry = deploymentMissing
        ? { retrying: false, message: DEPLOYMENT_REQUIRED_MESSAGE }
        : transientRetryOutcome(error, work);
      const potentialSideEffects = hasPotentialSideEffects(
        runtimeSession?.events.slice(sessionStartIndex) ?? [],
      );
      const retrying =
        retry.retrying && occurrence.attempt === 1 && !potentialSideEffects;
      const message =
        retry.retrying && potentialSideEffects
          ? "Chief stopped after a local runtime issue, but the task had already used tools. It will not retry automatically."
          : retry.retrying && occurrence.attempt > 1
            ? "Chief's local runtime did not recover after one automatic retry. Nothing external was changed."
            : (retry.message ?? safeWorkFailure(error));
      const artifacts =
        runtimeSession && beforeData
          ? await this.manager
              .workspaceData(workspaceId)
              .then((afterData) =>
                artifactsFromSession(
                  runtimeSession!.events.slice(sessionStartIndex),
                  beforeData!,
                  afterData,
                ),
              )
              .catch(() => [])
          : [];
      const transitionAt = Date.now();
      if (runtimeSession) {
        await this.manager.waitForChatPersistence(workspaceId, occurrence.id);
      }
      if (retrying) {
        await this.manager.waitingScheduleSession(
          workspaceId,
          {
            ...occurrence,
            status: "waiting",
            summary: message,
            error: message,
            artifacts: artifacts.length > 0 ? artifacts : undefined,
            blockedTools: blockedTools.length > 0 ? blockedTools : undefined,
            updatedAt: transitionAt,
          },
          {
            ...work,
            status: "active",
            nextAt: transitionAt + TRANSIENT_RETRY_DELAY_MS,
            lastSummary: message,
            updatedAt: transitionAt,
          },
        );
        terminalSaved = true;
        return;
      }
      const action: ActionItem = {
        id: deploymentMissing
          ? deploymentActionId(workspaceId)
          : `action-${work.id}-failed`,
        agentId: "cmo",
        title: deploymentMissing ? "Connect Chief" : work.title,
        reason: message,
        sourceId: occurrence.id,
        status: "open",
        createdAt: transitionAt,
      };
      await this.manager.finishScheduleSession(
        workspaceId,
        {
          ...occurrence,
          status: "failed",
          finishedAt: transitionAt,
          summary: message,
          error: message,
          artifacts: artifacts.length > 0 ? artifacts : undefined,
          blockedTools: blockedTools.length > 0 ? blockedTools : undefined,
          updatedAt: transitionAt,
        },
        {
          ...work,
          status: deploymentMissing
            ? "needs_approval"
            : work.onceAt === undefined
              ? "active"
              : "error",
          nextAt: deploymentMissing ? undefined : claimedNextAt,
          lastSummary: message,
          updatedAt: transitionAt,
        },
        {
          upsert: action,
          dismissIds: staleOutcomeActionIds(work.id).filter(
            (id) => id !== action.id,
          ),
        },
      );
      terminalSaved = true;
      this.deliverOutcome(
        workspaceId,
        work,
        "failed",
        occurrence.id,
        message,
        action,
      );
    } finally {
      this.activeWork.delete(workKey);
      this.activeSessions.delete(occurrence.id);
      this.activeCancellations.delete(occurrence.id);
      await this.manager
        .stopRuntimeChat(workspaceId, occurrence.id)
        .catch((stopError) =>
          console.error("[scheduler] could not stop task session:", stopError),
        );
      releaseExecution?.();
      await Promise.resolve(this.onChange(workspaceId)).catch((changeError) =>
        console.error("[scheduler] could not publish work state:", changeError),
      );
    }
  }
}
