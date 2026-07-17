import { useEffect, useMemo, useRef, useState } from "react";
import { useConvexAuth, useQuery } from "convex/react";
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUp,
  ArrowUpRight,
  BarChart3,
  CalendarClock,
  Check,
  ChevronLeft,
  ChevronRight,
  LoaderCircle,
  Plus,
  Sparkles,
} from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useNavigate } from "react-router";
import { Line, LineChart, ResponsiveContainer } from "recharts";

import type {
  AttentionItem,
  RecurringWorkRunRecord,
} from "@chief/agent-runtime/types";
import { api } from "@chief/backend/convex/_generated/api";

import type { AuthOrganization } from "../lib/auth/better-auth-client";
import { InputRequestSection } from "../components/integrations/input-request-section";
import { OrgLogo } from "../components/org-logo";
import { useAuth } from "../lib/auth/auth-context";
import {
  listAuthOrganizations,
  parseOrganizationMetadata,
} from "../lib/auth/better-auth-client";
import { createChat } from "../lib/chat-log";
import { findPendingInputRequest } from "../lib/integration-setup";
import { onboardingLegacyId } from "../lib/onboarding-ids";
import {
  buildOnboardingSchedules,
  onboardingSchedulePlanFromMetadata,
} from "../lib/onboarding-schedules";
import { onboardingWorkFromMetadata } from "../lib/onboarding-work";
import { presentRunText } from "../lib/run-copy";
import { useAgentChat, useWorkspaceData } from "../lib/runtime";
import { workspaceContextFromOrganization } from "../lib/workspace-context";

const AGENT_NAMES: Record<string, string> = {
  ads: "Ads Manager",
  analyst: "Analyst",
  brand: "Brand Researcher",
  cmo: "Chief Marketing Officer",
  content: "Content Writer",
  prospector: "Prospector",
  setup: "Setup",
};

const SUGGESTIONS = [
  "What should we focus on this week?",
  "Review our current marketing plan",
  "Where are we losing momentum?",
];

function greeting(now: number) {
  const hour = new Date(now).getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

interface DashboardSnapshot {
  provider: string;
  period: string;
  activeUsers?: number;
  pageViews?: number;
  conversions?: number;
  series?: { date: string; value: number }[];
  rangeMetrics?: {
    key: string;
    period: string;
    activeUsers?: number;
    pageViews?: number;
    conversions?: number;
  }[];
}

interface AnalyticsSlide {
  id: string;
  title: string;
  value: string;
  label: string;
  trend: number | null;
  points: { index: number; value: number }[] | null;
}

interface AgentWorkTimelineItem {
  id: string;
  kind: "history" | "running" | "upcoming";
  timestamp: number;
  timezone: string;
  title: string;
  agentId: string;
  runId?: string;
  status?: RecurringWorkRunRecord["status"];
  attemptCount?: number;
}

interface OverviewAction extends AttentionItem {
  inProgress: boolean;
  runId?: string;
}

function OverviewRunInput({
  agentId,
  run,
  recurringWorkId,
}: {
  agentId: string;
  run: RecurringWorkRunRecord;
  recurringWorkId: string;
}) {
  const [answeredInputs, setAnsweredInputs] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const { chat, provideInput, sessionReady } = useAgentChat(
    agentId,
    null,
    `automation-run-${run.id}`,
    undefined,
    undefined,
    undefined,
    undefined,
    true,
    recurringWorkId,
  );
  const pendingInput = useMemo(
    () => findPendingInputRequest(chat.items, answeredInputs),
    [answeredInputs, chat.items],
  );

  if (!sessionReady) {
    return (
      <p className="chief-overview-setup-loading animate-pulse">
        Loading the setup request…
      </p>
    );
  }
  if (!pendingInput) return null;

  return (
    <div className="chief-overview-setup-input">
      <InputRequestSection
        request={pendingInput}
        onSubmit={(request, values) => {
          provideInput(request, values);
          setAnsweredInputs((current) => new Set(current).add(request.id));
        }}
      />
    </div>
  );
}

function automationWorkId(sourceId?: string) {
  return sourceId?.startsWith("automation-")
    ? sourceId.slice("automation-".length)
    : undefined;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat(undefined, {
    notation: value > 9999 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(value);
}

function percentageChange(current?: number, previous?: number) {
  if (current === undefined || previous === undefined || previous <= 0) {
    return null;
  }
  return ((current - previous) / previous) * 100;
}

function trendTitle(label: string, trend: number | null, hasData: boolean) {
  if (!hasData) return `${label} will appear after the first report.`;
  if (trend === null) return `${label} has a new baseline.`;
  if (trend > 2) return `${label} is moving in the right direction.`;
  if (trend < -2) return `${label} needs a closer look.`;
  return `${label} is holding steady.`;
}

function chartPoints(values: number[]) {
  if (values.length < 2) return null;
  return values.map((value, index) => ({ index, value }));
}

function AnalyticsChart({
  points,
  reduceMotion,
}: {
  points: { index: number; value: number }[];
  reduceMotion: boolean;
}) {
  return (
    <div aria-hidden="true" className="chief-overview-chart">
      <ResponsiveContainer height="100%" width="100%">
        <LineChart
          data={points}
          margin={{ bottom: 2, left: 2, right: 2, top: 2 }}
        >
          <Line
            animationDuration={420}
            dataKey="value"
            dot={false}
            isAnimationActive={!reduceMotion}
            stroke="var(--foreground)"
            strokeOpacity={0.68}
            strokeWidth={1.25}
            type="monotone"
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function Trend({ value }: { value: number | null }) {
  if (value === null)
    return <span className="chief-overview-baseline">New</span>;
  const positive = value >= 0;
  return (
    <span
      className={
        positive
          ? "chief-overview-trend is-positive"
          : "chief-overview-trend is-negative"
      }
    >
      {positive ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
      {Math.abs(value).toFixed(1)}%
    </span>
  );
}

function WorkspaceIndicator({
  organization,
}: {
  organization: AuthOrganization | null;
}) {
  const metadata = organization ? parseOrganizationMetadata(organization) : {};

  if (!organization)
    return <span className="chief-overview-workspace-placeholder" />;

  return (
    <div className="chief-overview-workspace-indicator">
      <OrgLogo
        name={organization.name}
        logo={organization.logo}
        website={
          typeof metadata.websiteUrl === "string" ? metadata.websiteUrl : ""
        }
        className="size-6 shrink-0 text-xs"
      />
      <span>{organization.name}</span>
    </div>
  );
}

function dayKey(date: Date, timezone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: timezone,
  }).format(date);
}

function scheduleDate(timestamp: number, timezone: string, now: number) {
  const date = new Date(timestamp);
  const today = dayKey(new Date(now), timezone);
  const tomorrow = dayKey(new Date(now + 86_400_000), timezone);
  const target = dayKey(date, timezone);
  const day =
    target === today
      ? "Today"
      : target === tomorrow
        ? "Tomorrow"
        : new Intl.DateTimeFormat(undefined, {
            weekday: "short",
            timeZone: timezone,
          }).format(date);
  const time = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
  }).format(date);
  return { day, time };
}

export function DashboardPage() {
  const navigate = useNavigate();
  const prefersReducedMotion = useReducedMotion();
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const scheduleScrollRef = useRef<HTMLDivElement>(null);
  const scheduleFocusRef = useRef<HTMLButtonElement>(null);
  const scheduleRecoveryAttempted = useRef(false);
  const [scheduleRecoveryAttempt, setScheduleRecoveryAttempt] = useState(0);
  const [ask, setAsk] = useState("");
  const [organization, setOrganization] = useState<AuthOrganization | null>(
    null,
  );
  const [onboardingRecoveryState, setOnboardingRecoveryState] = useState<
    "checking" | "recovering" | "ready"
  >("ready");
  const [selectedAction, setSelectedAction] = useState(0);
  const [analyticsIndex, setAnalyticsIndex] = useState(0);
  const [analyticsPaused, setAnalyticsPaused] = useState(false);
  const { cloudOrganizationId, user } = useAuth();
  const convexAuth = useConvexAuth();
  const canQuery = convexAuth.isAuthenticated && Boolean(cloudOrganizationId);
  const snapshots = useQuery(
    api.analyticsSnapshots.listLatest,
    canQuery ? {} : "skip",
  ) as DashboardSnapshot[] | undefined;
  const workspaceData = useWorkspaceData(cloudOrganizationId);
  const {
    bootstrapOnboardingWork,
    loading: workspaceDataLoading,
    onboardingBootstrapReady,
  } = workspaceData;
  const recurringWorkIdSignature = workspaceData.recurringWork
    .map((work) => work.id)
    .sort()
    .join("\0");
  const onboardingRecovery = useMemo(() => {
    if (
      !organization ||
      !cloudOrganizationId ||
      organization.id !== cloudOrganizationId
    ) {
      return null;
    }
    const metadata = parseOrganizationMetadata(organization);
    const onboarding =
      metadata.onboarding && typeof metadata.onboarding === "object"
        ? (metadata.onboarding as Record<string, unknown>)
        : null;
    const plan = onboardingSchedulePlanFromMetadata(onboarding?.automation);
    if (!onboarding || !plan) {
      return { required: false as const, jobs: [], schedules: [] };
    }
    const existingIds = new Set(
      recurringWorkIdSignature.split("\0").filter(Boolean),
    );
    const schedules = buildOnboardingSchedules(
      plan,
      cloudOrganizationId,
    ).filter(
      (schedule) =>
        !existingIds.has(schedule.id) &&
        !existingIds.has(onboardingLegacyId(schedule.id, cloudOrganizationId)),
    );
    const jobs = onboardingWorkFromMetadata(
      cloudOrganizationId,
      organization.name,
      typeof metadata.websiteUrl === "string" ? metadata.websiteUrl : "",
      onboarding,
    ).filter(
      (job) =>
        !existingIds.has(job.id) &&
        !existingIds.has(onboardingLegacyId(job.id, cloudOrganizationId)),
    );
    return {
      required: jobs.length > 0 || schedules.length > 0,
      jobs,
      schedules,
    };
  }, [cloudOrganizationId, organization, recurringWorkIdSignature]);

  const agentSchedules = workspaceData.recurringWork.filter(
    (work) =>
      work.runOnceAt === undefined &&
      (work.status === "active" || work.status === "draft"),
  );
  const newProspects = workspaceData.prospects.filter(
    (prospect) => prospect.status === "new",
  ).length;
  const analytics = snapshots?.find(
    (snapshot) => snapshot.provider === "google-analytics",
  );
  const analytics30 =
    analytics?.rangeMetrics?.find((range) => range.key === "30d") ?? analytics;
  const previous30 = analytics?.rangeMetrics?.find(
    (range) => range.key === "previous30d",
  );
  const workById = useMemo(
    () => new Map(workspaceData.recurringWork.map((work) => [work.id, work])),
    [workspaceData.recurringWork],
  );
  const runStateByWorkId = useMemo(() => {
    const states = new Map<
      string,
      {
        started: boolean;
        latest?: RecurringWorkRunRecord;
        running?: RecurringWorkRunRecord;
      }
    >();
    for (const run of workspaceData.recurringWorkRuns) {
      const state = states.get(run.recurringWorkId) ?? { started: false };
      state.started = true;
      if (!state.latest || run.startedAt > state.latest.startedAt) {
        state.latest = run;
      }
      if (
        run.status === "running" &&
        (!state.running || run.startedAt > state.running.startedAt)
      ) {
        state.running = run;
      }
      states.set(run.recurringWorkId, state);
    }
    return states;
  }, [workspaceData.recurringWorkRuns]);
  const attention = useMemo<OverviewAction[]>(
    () =>
      workspaceData.attentionItems.map((item) => {
        const workId = automationWorkId(item.sourceId);
        const work = workId ? workById.get(workId) : undefined;
        const runState = workId ? runStateByWorkId.get(workId) : undefined;
        const runningRun = runState?.running;
        const latestRun = runState?.latest;
        const onboardingPending = Boolean(
          work?.id.startsWith("onboarding-") &&
          work.status === "active" &&
          work.lastRunAt === undefined &&
          !runState?.started,
        );
        return {
          ...item,
          inProgress: Boolean(runningRun) || onboardingPending,
          ...(runningRun || latestRun
            ? { runId: (runningRun ?? latestRun)!.id }
            : {}),
        };
      }),
    [workspaceData.attentionItems, runStateByWorkId, workById],
  );
  const resolvedActionIndex = Math.min(
    selectedAction,
    Math.max(0, attention.length - 1),
  );
  const currentAction = attention[resolvedActionIndex];
  const currentActionWorkId = automationWorkId(currentAction?.sourceId);
  const currentActionRun = currentActionWorkId
    ? runStateByWorkId.get(currentActionWorkId)?.latest
    : undefined;
  const agentWorkTimeline = useMemo<AgentWorkTimelineItem[]>(() => {
    // Run History remains attempt-level for diagnosis. The overview is an
    // operational timeline, so repeated outcomes for the same scheduled work
    // collapse into one entry instead of flooding the card after a recovery.
    const historyGroups = new Map<
      string,
      { run: RecurringWorkRunRecord; count: number }
    >();
    for (const run of workspaceData.recurringWorkRuns
      .filter((candidate) => candidate.status !== "running")
      .sort(
        (a, b) => (b.finishedAt ?? b.startedAt) - (a.finishedAt ?? a.startedAt),
      )) {
      const key = `${run.recurringWorkId}:${run.status}`;
      const group = historyGroups.get(key);
      if (group) {
        group.count += 1;
      } else {
        historyGroups.set(key, { run, count: 1 });
      }
    }
    const history = [...historyGroups.values()]
      .sort(
        (a, b) =>
          (b.run.finishedAt ?? b.run.startedAt) -
          (a.run.finishedAt ?? a.run.startedAt),
      )
      .slice(0, 6)
      .reverse()
      .map(({ run, count }) => {
        const work = workById.get(run.recurringWorkId);
        return {
          id: `history-${run.recurringWorkId}-${run.status}`,
          kind: "history" as const,
          timestamp: run.finishedAt ?? run.startedAt,
          timezone: work?.timezone ?? "UTC",
          title: work?.title ?? "Agent run",
          agentId: work?.agentId ?? "agent",
          runId: run.id,
          status: run.status,
          attemptCount: count,
        };
      });
    const running = workspaceData.recurringWorkRuns
      .filter((run) => run.status === "running")
      .sort((a, b) => a.startedAt - b.startedAt)
      .map((run) => {
        const work = workById.get(run.recurringWorkId);
        return {
          id: `running-${run.id}`,
          kind: "running" as const,
          timestamp: run.startedAt,
          timezone: work?.timezone ?? "UTC",
          title: work?.title ?? "Agent run",
          agentId: work?.agentId ?? "agent",
          runId: run.id,
          status: run.status,
        };
      });
    const upcoming = agentSchedules
      .flatMap((work) => {
        const next = work.upcomingRuns?.find(
          (timestamp) => timestamp > workspaceData.now,
        );
        return next
          ? [
              {
                id: `upcoming-${work.id}`,
                kind: "upcoming" as const,
                timestamp: next,
                timezone: work.timezone,
                title: work.title,
                agentId: work.agentId,
              },
            ]
          : [];
      })
      .sort((a, b) => a.timestamp - b.timestamp)
      .slice(0, 6);

    return [...history, ...running, ...upcoming];
  }, [
    agentSchedules,
    workById,
    workspaceData.now,
    workspaceData.recurringWorkRuns,
  ]);
  const focusedTimelineItemId =
    agentWorkTimeline.find((item) => item.kind === "running")?.id ??
    agentWorkTimeline.find((item) => item.kind === "upcoming")?.id ??
    agentWorkTimeline.at(-1)?.id;

  useEffect(() => {
    const container = scheduleScrollRef.current;
    const target = scheduleFocusRef.current;
    if (!container || !target || !focusedTimelineItemId) return;
    const frame = window.requestAnimationFrame(() => {
      const top =
        target.offsetTop - container.clientHeight / 2 + target.clientHeight / 2;
      container.scrollTo({
        top: Math.max(0, top),
        behavior: prefersReducedMotion ? "auto" : "smooth",
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusedTimelineItemId, prefersReducedMotion]);

  const analyticsSlides = useMemo<AnalyticsSlide[]>(() => {
    const trafficTrend = percentageChange(
      analytics30?.activeUsers,
      previous30?.activeUsers,
    );
    const signupTrend = percentageChange(
      analytics30?.conversions,
      previous30?.conversions,
    );
    const hasTraffic = analytics30?.activeUsers !== undefined;
    const hasSignups = analytics30?.conversions !== undefined;
    return [
      {
        id: "traffic",
        title: trendTitle("Traffic", trafficTrend, hasTraffic),
        value:
          snapshots === undefined
            ? "—"
            : formatNumber(analytics30?.activeUsers ?? 0),
        label: "active users",
        trend: trafficTrend,
        points: chartPoints(
          (analytics?.series ?? []).slice(-14).map((point) => point.value),
        ),
      },
      {
        id: "signups",
        title: trendTitle("Signups", signupTrend, hasSignups),
        value:
          snapshots === undefined
            ? "—"
            : formatNumber(analytics30?.conversions ?? 0),
        label: "tracked conversions",
        trend: signupTrend,
        points:
          analytics30?.conversions !== undefined &&
          previous30?.conversions !== undefined
            ? chartPoints([previous30.conversions, analytics30.conversions])
            : null,
      },
      {
        id: "prospects",
        title:
          newProspects > 0
            ? "New buying signals are ready to review."
            : "Prospecting is quiet right now.",
        value: workspaceData.loading ? "—" : formatNumber(newProspects),
        label: "new prospects",
        trend: null,
        points: null,
      },
    ];
  }, [
    analytics,
    analytics30,
    newProspects,
    previous30,
    snapshots,
    workspaceData.loading,
  ]);

  useEffect(() => {
    if (analyticsPaused || prefersReducedMotion || analyticsSlides.length < 2) {
      return;
    }
    const timer = window.setTimeout(() => {
      setAnalyticsIndex((current) => (current + 1) % analyticsSlides.length);
    }, 8_000);
    return () => window.clearTimeout(timer);
  }, [
    analyticsIndex,
    analyticsPaused,
    analyticsSlides.length,
    prefersReducedMotion,
  ]);
  useEffect(() => {
    let cancelled = false;
    let retryTimer: number | undefined;
    const resolveOrganization = async () => {
      try {
        const organizations = await listAuthOrganizations(false, {
          throwOnError: true,
        });
        if (cancelled) return;
        const nextOrganization =
          organizations.find(
            (candidate) => candidate.id === cloudOrganizationId,
          ) ??
          organizations[0] ??
          null;
        setOrganization(nextOrganization);
        scheduleRecoveryAttempted.current = false;
        setScheduleRecoveryAttempt(0);
        setOnboardingRecoveryState(nextOrganization ? "checking" : "ready");
      } catch (error) {
        if (cancelled) return;
        console.warn(
          "[Overview] Workspace metadata unavailable; retrying",
          error,
        );
        // Recovery metadata is helpful, but must never block live runtime data.
        setOnboardingRecoveryState("ready");
        retryTimer = window.setTimeout(() => {
          void resolveOrganization();
        }, 3_000);
      }
    };
    void resolveOrganization();
    return () => {
      cancelled = true;
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
    };
  }, [cloudOrganizationId]);

  useEffect(() => {
    if (
      !onboardingRecovery?.required ||
      workspaceDataLoading ||
      scheduleRecoveryAttempted.current
    ) {
      return;
    }
    if (!onboardingBootstrapReady) {
      return;
    }
    scheduleRecoveryAttempted.current = true;
    const workspaceContext = workspaceContextFromOrganization(organization);
    let cancelled = false;
    const stateTimer = window.setTimeout(() => {
      if (!cancelled) setOnboardingRecoveryState("recovering");
    }, 0);
    let retryTimer: number | undefined;
    const retry = () => {
      scheduleRecoveryAttempted.current = false;
      setOnboardingRecoveryState("checking");
      retryTimer = window.setTimeout(
        () => setScheduleRecoveryAttempt((attempt) => attempt + 1),
        Math.min(15_000, 1_500 * 2 ** Math.min(scheduleRecoveryAttempt, 3)),
      );
    };
    void bootstrapOnboardingWork(
      onboardingRecovery.jobs,
      onboardingRecovery.schedules,
      workspaceContext,
    )
      .then((accepted) => {
        if (cancelled) return;
        if (accepted) {
          setOnboardingRecoveryState("ready");
        } else {
          retry();
        }
      })
      .catch((error) => {
        if (cancelled) return;
        console.error("Could not recover onboarding schedules:", error);
        retry();
      });
    return () => {
      cancelled = true;
      scheduleRecoveryAttempted.current = false;
      window.clearTimeout(stateTimer);
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
    };
  }, [
    onboardingRecovery,
    organization,
    scheduleRecoveryAttempt,
    bootstrapOnboardingWork,
    onboardingBootstrapReady,
    workspaceDataLoading,
  ]);

  useEffect(() => {
    if (!currentAction || currentAction.inProgress) return;
    const dismissWithKeyboard = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        event.repeat ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.key.toLowerCase() !== "e" ||
        target?.isContentEditable ||
        target?.matches("input, textarea, select")
      ) {
        return;
      }
      event.preventDefault();
      workspaceData.dismissAttentionItem(currentAction.id);
    };
    window.addEventListener("keydown", dismissWithKeyboard);
    return () => window.removeEventListener("keydown", dismissWithKeyboard);
  }, [currentAction, workspaceData]);

  const moveAnalytics = (direction: number) => {
    setAnalyticsIndex(
      (current) =>
        (current + direction + analyticsSlides.length) % analyticsSlides.length,
    );
  };

  const selectAnalytics = (index: number) => {
    if (index === analyticsIndex) return;
    setAnalyticsIndex(index);
  };

  const moveAction = (direction: number) => {
    if (attention.length < 2) return;
    setSelectedAction(
      (current) => (current + direction + attention.length) % attention.length,
    );
  };

  const openAction = () => {
    void navigate(
      currentAction?.runId
        ? `/schedule/history?run=${encodeURIComponent(currentAction.runId)}`
        : currentAction
          ? `/schedule/history?attention=${encodeURIComponent(currentAction.id)}`
          : "/schedule/history",
    );
  };

  const chooseSuggestion = (suggestion: string) => {
    setAsk(suggestion);
    window.requestAnimationFrame(() => composerRef.current?.focus());
  };

  const resizeComposer = () => {
    const textarea = composerRef.current;
    if (!textarea) return;
    textarea.style.height = "0px";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 112)}px`;
  };

  const submit = () => {
    const text = ask.trim();
    if (!text) return;
    const conversation = createChat("cmo", text);
    void navigate(
      `/conversations?agent=cmo&chat=${conversation.id}&new=1&prompt=${encodeURIComponent(text)}`,
    );
  };

  const profileFirstName = user?.name.trim().split(/\s+/)[0];
  const firstName = profileFirstName ?? "there";
  const resolvedOnboardingRecoveryState =
    onboardingRecovery?.required === false ? "ready" : onboardingRecoveryState;
  const preparingWorkspace =
    workspaceData.loading || resolvedOnboardingRecoveryState !== "ready";

  return (
    <div className="chief-overview-page">
      <header className="chief-overview-heading">
        <div>
          <h1>
            {greeting(workspaceData.now)}, <span>{firstName}</span>
          </h1>
          <p>An overview of your channels and agents.</p>
        </div>
        <WorkspaceIndicator organization={organization} />
      </header>

      <section className="chief-overview-grid">
        <section className="chief-overview-actions" aria-label="Action items">
          {currentAction ? (
            <article className="chief-overview-action-card">
              <header>
                <div>
                  <span className="chief-overview-agent-icon">
                    {currentAction.inProgress ? (
                      <LoaderCircle className="animate-spin" size={14} />
                    ) : (
                      <BarChart3 size={14} />
                    )}
                  </span>
                  <span>
                    <strong>
                      {AGENT_NAMES[currentAction.agentId] ??
                        currentAction.agentId}
                    </strong>
                    <small>
                      {currentAction.inProgress
                        ? currentAction.runId
                          ? "Running now"
                          : "Starting now"
                        : `Prepared ${new Intl.RelativeTimeFormat(undefined, {
                            numeric: "auto",
                          }).format(
                            Math.max(
                              -30,
                              Math.round(
                                (currentAction.createdAt - workspaceData.now) /
                                  86_400_000,
                              ),
                            ),
                            "day",
                          )}`}
                    </small>
                  </span>
                </div>
                <small>
                  {resolvedActionIndex + 1} of {attention.length}
                </small>
              </header>
              <div className="chief-overview-action-copy">
                <h2>{currentAction.title}</h2>
                <p>
                  {presentRunText(
                    currentAction.reason,
                    "This work needs your attention.",
                  )}
                </p>
                {currentActionWorkId &&
                currentActionRun?.status === "needs_approval" ? (
                  <OverviewRunInput
                    key={currentActionRun.id}
                    agentId={currentAction.agentId}
                    recurringWorkId={currentActionWorkId}
                    run={currentActionRun}
                  />
                ) : null}
              </div>
              <footer>
                <div className="chief-overview-action-buttons">
                  <button type="button" onClick={openAction}>
                    {currentAction.inProgress ? "View run" : "Review"}
                  </button>
                  {!currentAction.inProgress ? (
                    <button
                      type="button"
                      aria-keyshortcuts="E"
                      onClick={() =>
                        workspaceData.dismissAttentionItem(currentAction.id)
                      }
                      title="Dismiss (E)"
                    >
                      Dismiss
                    </button>
                  ) : null}
                </div>
                <div className="chief-overview-action-pagination">
                  <button
                    aria-label="Previous action item"
                    onClick={() => moveAction(-1)}
                    type="button"
                  >
                    <ChevronLeft size={14} />
                  </button>
                  <span aria-hidden="true">
                    {attention.map((item, index) => (
                      <i
                        className={
                          index === resolvedActionIndex ? "is-active" : ""
                        }
                        key={item.id}
                      />
                    ))}
                  </span>
                  <button
                    aria-label="Next action item"
                    onClick={() => moveAction(1)}
                    type="button"
                  >
                    <ChevronRight size={14} />
                  </button>
                </div>
              </footer>
            </article>
          ) : (
            <article className="chief-overview-caught-up">
              <span>
                {preparingWorkspace ? (
                  <LoaderCircle className="animate-spin" size={17} />
                ) : (
                  <Check size={17} />
                )}
              </span>
              <h2>
                {preparingWorkspace
                  ? resolvedOnboardingRecoveryState === "recovering"
                    ? "Starting your agent work…"
                    : "Checking the workspace…"
                  : "You’re caught up."}
              </h2>
              <p>
                {preparingWorkspace
                  ? resolvedOnboardingRecoveryState === "recovering"
                    ? "Chief is restoring the work selected during onboarding."
                    : "Chief is gathering the latest work from your agents."
                  : agentSchedules.length > 0
                    ? `Nothing needs your judgment. ${agentSchedules.length} recurring ${agentSchedules.length === 1 ? "job is" : "jobs are"} still running.`
                    : "Nothing needs your judgment. Choose recurring work when you’re ready to put the team in motion."}
              </p>
              <button type="button" onClick={() => navigate("/schedule")}>
                View schedule <ArrowRight size={13} />
              </button>
            </article>
          )}

          {attention.length > 1 ? (
            <div className="chief-overview-action-queue">
              {attention.slice(0, 4).map((item, index) => (
                <button
                  className={index === resolvedActionIndex ? "is-active" : ""}
                  key={item.id}
                  onClick={() => setSelectedAction(index)}
                  type="button"
                >
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <strong>{item.title}</strong>
                  <small>{AGENT_NAMES[item.agentId] ?? item.agentId}</small>
                </button>
              ))}
            </div>
          ) : null}
        </section>

        <aside className="chief-overview-side">
          <section
            aria-label="Workspace analytics"
            className="chief-overview-analytics"
            onBlurCapture={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) {
                setAnalyticsPaused(false);
              }
            }}
            onFocusCapture={() => setAnalyticsPaused(true)}
            onMouseEnter={() => setAnalyticsPaused(true)}
            onMouseLeave={() => setAnalyticsPaused(false)}
          >
            {analyticsSlides.map((slide, index) => {
              const isActive = index === analyticsIndex;
              return (
                <motion.article
                  animate={{
                    opacity: isActive ? 1 : 0,
                    x: prefersReducedMotion
                      ? 0
                      : isActive
                        ? 0
                        : index < analyticsIndex
                          ? -8
                          : 8,
                  }}
                  aria-hidden={!isActive}
                  className="chief-overview-analytics-slide"
                  initial={false}
                  key={slide.id}
                  onClick={() => navigate("/analytics")}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    navigate("/analytics");
                  }}
                  role="link"
                  style={{
                    pointerEvents: isActive ? "auto" : "none",
                    zIndex: isActive ? 1 : 0,
                  }}
                  tabIndex={isActive ? 0 : -1}
                  transition={{
                    duration: prefersReducedMotion ? 0 : 0.28,
                    ease: [0.22, 1, 0.36, 1],
                  }}
                >
                  <h2>{slide.title}</h2>
                  <div className="chief-overview-analytics-value">
                    <strong>{slide.value}</strong>
                    <span>{slide.label}</span>
                    <Trend value={slide.trend} />
                  </div>
                  {slide.points ? (
                    <AnalyticsChart
                      points={slide.points}
                      reduceMotion={Boolean(prefersReducedMotion)}
                    />
                  ) : null}
                </motion.article>
              );
            })}
            <div className="chief-overview-action-pagination chief-overview-analytics-pagination">
              <button
                aria-label="Previous analytics card"
                onClick={() => moveAnalytics(-1)}
                type="button"
              >
                <ChevronLeft size={14} />
              </button>
              <span aria-label="Analytics cards">
                {analyticsSlides.map((slide, index) => (
                  <button
                    aria-label={`Show ${slide.label}`}
                    aria-pressed={index === analyticsIndex}
                    key={slide.id}
                    onClick={() => selectAnalytics(index)}
                    type="button"
                  >
                    <i
                      className={index === analyticsIndex ? "is-active" : ""}
                    />
                  </button>
                ))}
              </span>
              <button
                aria-label="Next analytics card"
                onClick={() => moveAnalytics(1)}
                type="button"
              >
                <ChevronRight size={14} />
              </button>
            </div>
          </section>

          <section className="chief-overview-schedule" aria-label="Agent work">
            <header>
              <span>
                <CalendarClock size={12} /> Agent work
              </span>
              <button onClick={() => navigate("/schedule")} type="button">
                View schedule <ArrowRight size={11} />
              </button>
            </header>
            <div
              className="chief-overview-schedule-scroll"
              ref={scheduleScrollRef}
            >
              {agentWorkTimeline.length > 0 ? (
                <div className="chief-overview-timeline">
                  {agentWorkTimeline.map((item) => {
                    const when = scheduleDate(
                      item.timestamp,
                      item.timezone,
                      workspaceData.now,
                    );
                    const state =
                      item.kind === "running"
                        ? "Running now"
                        : item.kind === "upcoming"
                          ? "Scheduled"
                          : item.status === "completed"
                            ? "Completed"
                            : item.status === "waiting"
                              ? "Setup continuing"
                              : item.status === "needs_approval"
                                ? "Needs input"
                                : "Stopped";
                    return (
                      <button
                        key={item.id}
                        ref={
                          item.id === focusedTimelineItemId
                            ? scheduleFocusRef
                            : undefined
                        }
                        onClick={() =>
                          item.runId
                            ? navigate(
                                `/schedule/history?run=${encodeURIComponent(item.runId)}`,
                              )
                            : navigate("/schedule")
                        }
                        type="button"
                      >
                        <time>
                          <strong>
                            {item.kind === "running" ? "Now" : when.day}
                          </strong>
                          <span>{when.time}</span>
                        </time>
                        <i
                          className={`is-${
                            item.kind === "upcoming"
                              ? "upcoming"
                              : item.kind === "running"
                                ? "running"
                                : (item.status ?? "history")
                          }`}
                        >
                          {item.kind === "running" ? (
                            <LoaderCircle aria-hidden size={10} />
                          ) : null}
                        </i>
                        <span>
                          <strong>{item.title}</strong>
                          <small>
                            {item.attemptCount && item.attemptCount > 1
                              ? `${state} ${item.attemptCount} attempts`
                              : state}{" "}
                            · {AGENT_NAMES[item.agentId] ?? item.agentId}
                          </small>
                        </span>
                        <ArrowRight aria-hidden size={10} />
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="chief-overview-schedule-empty">
                  <CalendarClock size={16} />
                  <span>
                    <strong>No upcoming work</strong>
                    <small>Your schedule is clear.</small>
                  </span>
                </div>
              )}
            </div>
          </section>
        </aside>
      </section>

      <div className="chief-overview-composer-dock">
        <div
          className="chief-overview-suggestions"
          aria-label="Suggested questions"
        >
          {SUGGESTIONS.map((suggestion) => (
            <button
              key={suggestion}
              onClick={() => chooseSuggestion(suggestion)}
              type="button"
            >
              {suggestion}
            </button>
          ))}
        </div>
        <div className="chief-overview-composer">
          <textarea
            aria-label="Message your Chief Marketing Officer"
            className="chief-overview-composer-input"
            onChange={(event) => {
              setAsk(event.target.value);
              resizeComposer();
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                submit();
              }
            }}
            placeholder="Ask your Chief Marketing Officer a question"
            ref={composerRef}
            rows={1}
            value={ask}
          />
          <footer>
            <button
              aria-label="Add context"
              className="chief-overview-add-context"
              type="button"
            >
              <Plus size={15} />
            </button>
            <span>
              <Sparkles size={12} /> Chief
            </span>
            <button
              aria-label="Send message"
              className="chief-overview-send"
              disabled={!ask.trim()}
              onClick={submit}
              type="button"
            >
              <ArrowUp size={15} />
            </button>
          </footer>
        </div>
      </div>
    </div>
  );
}
