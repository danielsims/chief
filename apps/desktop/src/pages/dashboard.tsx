import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  CalendarClock,
  Check,
  ChevronLeft,
  ChevronRight,
  LoaderCircle,
} from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useNavigate } from "react-router";
import {
  Line,
  LineChart,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
} from "recharts";

import type {
  ActionItem,
  AnalyticsDataset,
  AnalyticsDatasetPeriod,
  ChatExecutionSelection,
  SessionRecord,
} from "@chief/agent-runtime/types";
import { cn } from "@chief/ui/lib/utils";

import type { AuthOrganization } from "../lib/auth/better-auth-client";
import { ChatComposer } from "../components/chat/chat-composer";
import { InputRequestSection } from "../components/integrations/input-request-section";
import { OrgLogo } from "../components/org-logo";
import { useAgentConfig } from "../lib/agent-config";
import { setAgentOverride, setWorkspaceProvider } from "../lib/agent-overrides";
import { useAuth } from "../lib/auth/auth-context";
import {
  listAuthOrganizations,
  parseOrganizationMetadata,
} from "../lib/auth/better-auth-client";
import { createChat } from "../lib/chat-log";
import {
  isDeploymentRecoveryAction,
  localChiefPreference,
} from "../lib/deployment-recovery";
import {
  findPendingInputRequest,
  googleAnalyticsActionChatId,
  integrationSetupChatId,
  isConnectionAction,
  isGoogleAnalyticsConnectionAction,
  isOnboardingGoogleAnalyticsAction,
} from "../lib/integration-setup";
import {
  isOnboardingEngineeringAction,
  onboardingEngineeringSetup,
  selectedGoogleAnalyticsDuringOnboarding,
} from "../lib/onboarding-engineering";
import {
  useAgentPreferences,
  useLocalIntegrationStatus,
  useObservedChat,
  useWorkspaceData,
} from "../lib/runtime";

const AGENT_NAMES: Record<string, string> = {
  ads: "Ads Manager",
  analyst: "Analyst",
  brand: "Brand Researcher",
  cmo: "Chief Marketing Officer",
  content: "Content Writer",
  prospector: "Prospector",
  setup: "Setup",
};

const LEARNING_ACTION_ID = "workspace-initial-review";

interface OverviewAction {
  id: string;
  title: string;
  agentId: string;
  action?: ActionItem;
}

function greeting(now: number) {
  const hour = new Date(now).getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

interface AnalyticsSlide {
  id: string;
  title: string;
  value: string;
  label: string;
  trend: number | null;
  points: { x: string; value: number }[] | null;
}

interface AgentWorkTimelineItem {
  id: string;
  kind: "active" | "upcoming";
  timestamp: number;
  timezone: string;
  title: string;
  agentId: string;
  taskCount?: number;
  onceAt?: number;
  parentId?: string;
  childId?: string;
  status?: SessionRecord["status"];
}

function OverviewTaskInput({ task }: { task: SessionRecord }) {
  const [answeredInputs, setAnsweredInputs] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const { messages, provideInput, chatReady } = useObservedChat(
    task.id,
    task.scheduleId,
  );
  const pendingInput = useMemo(
    () => findPendingInputRequest(messages, answeredInputs),
    [answeredInputs, messages],
  );

  if (!chatReady) {
    return (
      <p className="chief-overview-setup-loading animate-pulse">
        Loading the task request…
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

function normalizedMetricKey(value: unknown) {
  return typeof value === "string"
    ? value.toLowerCase().replace(/[^a-z0-9]/g, "")
    : "";
}

function metricLabel(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim()
    ? value.toLowerCase()
    : fallback;
}

function periodMetric(
  period: AnalyticsDatasetPeriod | undefined,
  candidates: string[],
) {
  const accepted = new Set(candidates.map(normalizedMetricKey));
  return period?.values.find((item) =>
    accepted.has(normalizedMetricKey(item.metric)),
  )?.value;
}

function trendTitle(label: string, trend: number | null, hasData: boolean) {
  if (!hasData) return `${label} will appear after the first report.`;
  if (trend === null) return `${label} has a new baseline.`;
  if (trend > 2) return `${label} is moving in the right direction.`;
  if (trend < -2) return `${label} needs a closer look.`;
  return `${label} is holding steady.`;
}

function chartPoints(points: { x: string; value: number }[]) {
  return points.length < 2 ? null : points;
}

function chartPointLabel(value: string) {
  const compactDate = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  const dashedDate = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const match = compactDate ?? dashedDate;
  if (!match) return value;

  const [, year, month, day] = match;
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
  }).format(new Date(Number(year), Number(month) - 1, Number(day)));
}

function AnalyticsChart({
  label,
  points,
  reduceMotion,
}: {
  label: string;
  points: { x: string; value: number }[];
  reduceMotion: boolean;
}) {
  return (
    <div aria-hidden="true" className="chief-overview-chart">
      <ResponsiveContainer height="100%" width="100%">
        <LineChart
          data={points}
          margin={{ bottom: 2, left: 2, right: 2, top: 2 }}
        >
          <RechartsTooltip
            allowEscapeViewBox={{ x: true, y: true }}
            content={({ active, payload }) => {
              const point = payload[0]?.payload as
                { x?: string; value?: number } | undefined;
              if (!active || point?.value === undefined) return null;

              return (
                <div className="border-border bg-popover text-popover-foreground min-w-28 border px-2.5 py-2 shadow-lg">
                  {point.x ? (
                    <p className="text-muted-foreground text-[10px]">
                      {chartPointLabel(point.x)}
                    </p>
                  ) : null}
                  <p className="mt-0.5 flex items-baseline justify-between gap-4 text-xs">
                    <span>{label}</span>
                    <strong className="font-medium">
                      {formatNumber(point.value)}
                    </strong>
                  </p>
                </div>
              );
            }}
            cursor={false}
            isAnimationActive={false}
            wrapperStyle={{ pointerEvents: "none", zIndex: 5 }}
          />
          <Line
            activeDot={{ fill: "var(--foreground)", r: 3, strokeWidth: 0 }}
            animationDuration={420}
            dataKey="value"
            dot={false}
            isAnimationActive={!reduceMotion}
            stroke="var(--foreground)"
            strokeOpacity={0.68}
            strokeWidth={1.25}
            type="linear"
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

function OverviewActionPagination({
  actions,
  index,
  onMove,
  className,
}: {
  actions: OverviewAction[];
  index: number;
  onMove: (direction: number) => void;
  className?: string;
}) {
  return (
    <div className={cn("chief-overview-action-pagination", className)}>
      <button
        aria-label="Previous action item"
        onClick={() => onMove(-1)}
        type="button"
      >
        <ChevronLeft size={14} />
      </button>
      <span aria-hidden="true">
        {actions.map((item, itemIndex) => (
          <i className={itemIndex === index ? "is-active" : ""} key={item.id} />
        ))}
      </span>
      <button
        aria-label="Next action item"
        onClick={() => onMove(1)}
        type="button"
      >
        <ChevronRight size={14} />
      </button>
    </div>
  );
}

function WorkspaceLearningCard({
  reviewChatId,
  onOpen,
  actions,
  index,
  onMove,
}: {
  reviewChatId?: string;
  onOpen: () => void;
  actions: OverviewAction[];
  index: number;
  onMove: (direction: number) => void;
}) {
  return (
    <article className="chief-overview-caught-up">
      <span>
        <LoaderCircle className="animate-spin" size={17} />
      </span>
      <h2>Chief is learning your business.</h2>
      <p>
        Chief is reviewing your website, saved context and connected sources.
        You can leave this open; the work will continue.
      </p>
      <button
        className="is-primary"
        type="button"
        disabled={!reviewChatId}
        onClick={onOpen}
      >
        {reviewChatId ? "View initial review" : "Preparing initial review"}{" "}
        <ArrowRight size={13} />
      </button>
      <OverviewActionPagination
        actions={actions}
        className="chief-overview-learning-pagination"
        index={index}
        onMove={onMove}
      />
    </article>
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
  const scheduleScrollRef = useRef<HTMLDivElement>(null);
  const scheduleFocusRef = useRef<HTMLButtonElement>(null);
  const [ask, setAsk] = useState("");
  const [selectedExecution, setSelectedExecution] =
    useState<ChatExecutionSelection | null>(null);
  const [organization, setOrganization] = useState<AuthOrganization | null>(
    null,
  );
  const [selectedActionId, setSelectedActionId] = useState<string | null>(null);
  const [continuingChatId, setContinuingChatId] = useState<string | null>(null);
  const [analyticsIndex, setAnalyticsIndex] = useState(0);
  const [analyticsPaused, setAnalyticsPaused] = useState(false);
  const { cloudOrganizationId, user } = useAuth();
  const agentConfig = useAgentConfig();
  const chiefConfig = agentConfig.forAgent("cmo");
  const overviewExecution =
    selectedExecution ??
    (chiefConfig.driver
      ? { driver: chiefConfig.driver, model: chiefConfig.model || undefined }
      : undefined);
  const workspaceData = useWorkspaceData(cloudOrganizationId);
  const { integrations: localIntegrations } = useLocalIntegrationStatus();
  const datasets = workspaceData.loading
    ? undefined
    : workspaceData.analyticsDatasets.filter(
        (dataset) => dataset.key === "overview",
      );
  const agentPreferences = useAgentPreferences(cloudOrganizationId);

  const agentSchedules = workspaceData.recurringWork.filter(
    (work) =>
      work.onceAt === undefined &&
      (work.status === "active" || work.status === "draft"),
  );
  const newProspects = workspaceData.prospects.filter(
    (prospect) => prospect.status === "new",
  ).length;
  const analytics = datasets?.reduce<AnalyticsDataset | undefined>(
    (latest, dataset) =>
      !latest || dataset.capturedAt > latest.capturedAt ? dataset : latest,
    undefined,
  );
  const analytics30 =
    analytics?.periods.find((period) => period.key === "30d") ??
    analytics?.periods.find((period) => period.key === "current") ??
    analytics?.periods[0];
  const previous30 =
    analytics?.periods.find(
      (period) => period.key === "previous30d" || period.key === "previous",
    ) ?? analytics?.periods.find((period) => period !== analytics30);
  const scheduleById = useMemo(
    () => new Map(workspaceData.recurringWork.map((work) => [work.id, work])),
    [workspaceData.recurringWork],
  );
  const privateTasksById = useMemo(
    () =>
      new Map(
        workspaceData.activity
          .filter(
            (session) =>
              session.kind === "task" && session.visibility === "private",
          )
          .map((session) => [session.id, session]),
      ),
    [workspaceData.activity],
  );
  const engineeringSetup = useMemo(
    () =>
      onboardingEngineeringSetup(
        cloudOrganizationId,
        organization,
        localIntegrations,
      ),
    [cloudOrganizationId, localIntegrations, organization],
  );
  const nextEngineeringIntegration = engineeringSetup.nextIntegration;
  const actions = useMemo(() => {
    const tracked = workspaceData.actionItems;
    const hasGoogleAnalyticsAction = tracked.some(
      isGoogleAnalyticsConnectionAction,
    );
    const googleAnalyticsConnected = localIntegrations?.some(
      (integration) =>
        integration.provider === "google-analytics" &&
        integration.status === "connected",
    );
    const additions: ActionItem[] = [];
    if (
      cloudOrganizationId &&
      localIntegrations !== null &&
      !googleAnalyticsConnected &&
      !hasGoogleAnalyticsAction &&
      selectedGoogleAnalyticsDuringOnboarding(organization)
    ) {
      additions.push({
        id: `onboarding-google-analytics-recovery-${cloudOrganizationId}`,
        agentId: "setup",
        title: "Connect Google Analytics",
        reason:
          "Google Analytics was selected during onboarding. Open Setup and sign in with the Google account that administers the Analytics property you want Chief to use.",
        status: "open" as const,
        createdAt: 0,
      });
    }
    if (
      engineeringSetup.action &&
      !tracked.some(isOnboardingEngineeringAction)
    ) {
      additions.push(engineeringSetup.action);
    }
    return [...additions, ...tracked];
  }, [
    cloudOrganizationId,
    localIntegrations,
    engineeringSetup.action,
    organization,
    workspaceData.actionItems,
  ]);
  const preparationRoot = workspaceData.activity.find(
    (session) =>
      session.id.startsWith("workspace-kickoff-") &&
      session.kind === "conversation" &&
      session.visibility === "user",
  );
  const preparationChildren = useMemo(
    () =>
      preparationRoot
        ? workspaceData.activity.filter(
            (session) =>
              session.parentId === preparationRoot.id &&
              session.kind === "task" &&
              session.visibility === "private" &&
              !session.scheduleId,
          )
        : [],
    [preparationRoot, workspaceData.activity],
  );
  const preparationActive = Boolean(
    preparationRoot &&
    [preparationRoot, ...preparationChildren].some(
      (session) =>
        (session.status === "running" || session.status === "waiting") &&
        workspaceData.now - session.updatedAt < 10 * 60_000,
    ),
  );
  const initialReviewStartedAt = cloudOrganizationId
    ? Number(
        sessionStorage.getItem(`chief:initial-review:${cloudOrganizationId}`),
      )
    : Number.NaN;
  const initialReviewPending = Boolean(
    Number.isFinite(initialReviewStartedAt) &&
    workspaceData.now - initialReviewStartedAt < 10 * 60_000 &&
    (!preparationRoot || preparationRoot.status === "idle"),
  );
  const showLearningCard = initialReviewPending || preparationActive;
  const overviewActions = useMemo<OverviewAction[]>(
    () => [
      ...(showLearningCard
        ? [
            {
              id: LEARNING_ACTION_ID,
              title: "Chief is learning your business",
              agentId: "cmo",
            },
          ]
        : []),
      ...actions.map((action) => ({
        id: action.id,
        title: action.title,
        agentId: action.agentId,
        action,
      })),
    ],
    [actions, showLearningCard],
  );
  useEffect(() => {
    if (
      cloudOrganizationId &&
      preparationRoot &&
      preparationRoot.status !== "idle"
    ) {
      sessionStorage.removeItem(`chief:initial-review:${cloudOrganizationId}`);
    }
  }, [cloudOrganizationId, preparationRoot]);
  const requestedOverviewActionIndex = selectedActionId
    ? overviewActions.findIndex((item) => item.id === selectedActionId)
    : 0;
  const resolvedOverviewActionIndex = Math.max(0, requestedOverviewActionIndex);
  const selectedOverviewAction = overviewActions[resolvedOverviewActionIndex];
  const learningSelected = selectedOverviewAction?.id === LEARNING_ACTION_ID;
  const currentAction = selectedOverviewAction?.action;
  const deploymentRecovery = isDeploymentRecoveryAction(currentAction);
  const currentActionTask = currentAction?.sourceId
    ? privateTasksById.get(currentAction.sourceId)
    : undefined;
  const currentActionInProgress = currentActionTask?.status === "running";
  const currentActionBlocked = Boolean(
    currentActionTask?.scheduleId && currentActionTask.blockedTools?.length,
  );
  const currentActionFailed = Boolean(
    currentActionTask?.scheduleId && currentActionTask.status === "failed",
  );
  const agentWorkTimeline = useMemo<AgentWorkTimelineItem[]>(() => {
    const activeTasks = workspaceData.activity.filter(
      (session) =>
        session.kind === "task" &&
        session.visibility === "private" &&
        session.status === "running" &&
        workspaceData.now - session.updatedAt < 10 * 60_000 &&
        (!preparationActive || session.parentId !== preparationRoot?.id),
    );
    const firstActiveTask = activeTasks.reduce<SessionRecord | undefined>(
      (earliest, task) =>
        !earliest ||
        (task.startedAt ?? task.createdAt) <
          (earliest.startedAt ?? earliest.createdAt)
          ? task
          : earliest,
      undefined,
    );
    const scheduledActive = firstActiveTask
      ? [
          {
            id: "active-work",
            kind: "active" as const,
            timestamp: firstActiveTask.startedAt ?? firstActiveTask.createdAt,
            timezone: firstActiveTask.scheduleId
              ? (scheduleById.get(firstActiveTask.scheduleId)?.timezone ??
                Intl.DateTimeFormat().resolvedOptions().timeZone)
              : Intl.DateTimeFormat().resolvedOptions().timeZone,
            title: "Chief is working",
            agentId: "cmo",
            taskCount: activeTasks.length,
            parentId: firstActiveTask.parentId,
            status: firstActiveTask.status,
          },
        ]
      : [];
    const preparation =
      preparationActive && preparationRoot
        ? [preparationRoot, ...preparationChildren].map((session) => ({
            id: `preparation-${session.id}`,
            kind: "active" as const,
            timestamp: session.startedAt ?? session.createdAt,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            title:
              session.id === preparationRoot.id
                ? "Learning your business"
                : session.title,
            agentId: session.agent,
            parentId: session.parentId ?? session.id,
            childId: session.parentId ? session.id : undefined,
            status: session.status,
          }))
        : [];
    const upcoming = workspaceData.recurringWork
      .filter((work) => work.status === "active" || work.status === "draft")
      .flatMap((work) => {
        return work.nextAt && work.nextAt > workspaceData.now
          ? [
              {
                id: `upcoming-${work.id}`,
                kind: "upcoming" as const,
                timestamp: work.nextAt,
                timezone: work.timezone,
                title: work.title,
                agentId: work.agentId,
                onceAt: work.onceAt,
              },
            ]
          : [];
      })
      .sort((a, b) => a.timestamp - b.timestamp)
      .slice(0, 6);

    return [...preparation, ...scheduledActive, ...upcoming];
  }, [
    preparationActive,
    preparationChildren,
    preparationRoot,
    scheduleById,
    workspaceData.activity,
    workspaceData.now,
    workspaceData.recurringWork,
  ]);
  const focusedTimelineItemId =
    agentWorkTimeline.find((item) => item.kind === "active")?.id ??
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
    const currentTraffic = periodMetric(analytics30, [
      "activeUsers",
      "users",
      "sessions",
    ]);
    const previousTraffic = periodMetric(previous30, [
      "activeUsers",
      "users",
      "sessions",
    ]);
    const currentSignups = periodMetric(analytics30, [
      "conversions",
      "keyEvents",
      "signups",
    ]);
    const previousSignups = periodMetric(previous30, [
      "conversions",
      "keyEvents",
      "signups",
    ]);
    const trafficTrend = percentageChange(currentTraffic, previousTraffic);
    const signupTrend = percentageChange(currentSignups, previousSignups);
    const hasTraffic = currentTraffic !== undefined;
    const hasSignups = currentSignups !== undefined;
    const trafficMetric = analytics?.metrics.find((metric) =>
      ["activeusers", "users", "sessions"].includes(
        normalizedMetricKey(metric.key),
      ),
    );
    const signupMetric = analytics?.metrics.find((metric) =>
      ["conversions", "keyevents", "signups"].includes(
        normalizedMetricKey(metric.key),
      ),
    );
    const trafficSeries = analytics?.series?.find((series) =>
      ["activeusers", "users", "sessions"].includes(
        normalizedMetricKey(series.metric || series.id || series.label),
      ),
    );
    return [
      {
        id: "traffic",
        title: trendTitle("Traffic", trafficTrend, hasTraffic),
        value: datasets === undefined ? "—" : formatNumber(currentTraffic ?? 0),
        label: metricLabel(trafficMetric?.label, "traffic"),
        trend: trafficTrend,
        points: chartPoints((trafficSeries?.points ?? []).slice(-14)),
      },
      {
        id: "signups",
        title: trendTitle("Signups", signupTrend, hasSignups),
        value: datasets === undefined ? "—" : formatNumber(currentSignups ?? 0),
        label: metricLabel(signupMetric?.label, "tracked conversions"),
        trend: signupTrend,
        points:
          currentSignups !== undefined && previousSignups !== undefined
            ? chartPoints([
                {
                  x: previous30?.label ?? "Previous period",
                  value: previousSignups,
                },
                {
                  x: analytics30?.label ?? "Current period",
                  value: currentSignups,
                },
              ])
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
    datasets,
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
      } catch (error) {
        if (cancelled) return;
        console.warn(
          "[Overview] Workspace metadata unavailable; retrying",
          error,
        );
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
    if (!currentAction || currentActionInProgress) return;
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
      workspaceData.dismissActionItem(currentAction.id);
    };
    window.addEventListener("keydown", dismissWithKeyboard);
    return () => window.removeEventListener("keydown", dismissWithKeyboard);
  }, [currentAction, currentActionInProgress, workspaceData]);

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
    if (overviewActions.length < 2) return;
    setSelectedActionId(
      overviewActions[
        (resolvedOverviewActionIndex + direction + overviewActions.length) %
          overviewActions.length
      ]?.id ?? null,
    );
  };

  const openAction = (action = currentAction) => {
    if (!action) return;
    if (isOnboardingEngineeringAction(action) && nextEngineeringIntegration) {
      localStorage.setItem(
        `chief:integration-setup:${nextEngineeringIntegration.domain}`,
        "active",
      );
      void navigate(
        `/conversations?chat=${encodeURIComponent(
          integrationSetupChatId(nextEngineeringIntegration.domain),
        )}`,
      );
      return;
    }
    if (
      isGoogleAnalyticsConnectionAction(action) &&
      isOnboardingGoogleAnalyticsAction(action.id)
    ) {
      void navigate(
        `/conversations?chat=${encodeURIComponent(googleAnalyticsActionChatId(action.id))}`,
      );
      return;
    }
    if (isGoogleAnalyticsConnectionAction(action)) {
      localStorage.setItem(
        "chief:integration-setup:analytics.googleapis.com",
        "active",
      );
      void navigate("/analytics");
      return;
    }
    if (action.sourceId === "agent-cmo") {
      void navigate("/agents");
      return;
    }
    if (isConnectionAction(action)) {
      void navigate("/settings/integrations");
      return;
    }
    if (
      privateTasksById.get(action.sourceId ?? "")?.scheduleId ||
      action.sourceId?.startsWith("automation-")
    ) {
      void navigate("/schedule");
      return;
    }
    void navigate("/conversations");
  };

  const resolveAction = () => {
    if (deploymentRecovery) return;
    if (
      currentActionBlocked &&
      currentActionTask?.scheduleId &&
      currentActionTask.blockedTools
    ) {
      workspaceData.expandRecurringWorkGrant(
        currentActionTask.scheduleId,
        currentActionTask.blockedTools,
        true,
      );
      return;
    }
    if (currentActionFailed && currentActionTask?.scheduleId) {
      workspaceData.runRecurringWorkNow(currentActionTask.scheduleId);
      return;
    }
    openAction();
  };

  const useCodexLocally = () => {
    if (!cloudOrganizationId || !currentAction) return;
    const existing = agentPreferences.preferences.find(
      (preference) => preference.agentId === "cmo",
    );
    setWorkspaceProvider(cloudOrganizationId, "codex");
    setAgentOverride(cloudOrganizationId, "cmo", {
      driver: "codex",
      model: undefined,
      enabled: true,
    });
    agentPreferences.save(localChiefPreference(existing));
    workspaceData.dismissActionItem(currentAction.id);
  };

  const submit = () => {
    const text = ask.trim();
    if (!text || !overviewExecution?.driver) return;
    const conversation = createChat(text);
    const params = new URLSearchParams({
      chat: conversation.id,
      prompt: text,
      driver: overviewExecution.driver,
    });
    if (overviewExecution.model) params.set("model", overviewExecution.model);
    void navigate(`/conversations?${params.toString()}`);
  };

  const profileFirstName = user?.name.trim().split(/\s+/)[0];
  const firstName = profileFirstName ?? "there";
  const preparingWorkspace =
    workspaceData.loading ||
    initialReviewPending ||
    preparationActive ||
    Boolean(continuingChatId);
  const activeAnalyticsSlide =
    analyticsSlides[analyticsIndex] ?? analyticsSlides[0];

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
        <section
          className={cn(
            "chief-overview-actions",
            learningSelected && "is-learning",
          )}
          aria-label="Action items"
        >
          {learningSelected ? (
            <WorkspaceLearningCard
              actions={overviewActions}
              index={resolvedOverviewActionIndex}
              onMove={moveAction}
              reviewChatId={preparationRoot?.id}
              onOpen={() => {
                if (preparationRoot) {
                  void navigate(
                    `/conversations?chat=${encodeURIComponent(preparationRoot.id)}`,
                  );
                }
              }}
            />
          ) : currentAction ? (
            <article
              className={cn(
                "chief-overview-action-card",
                !currentAction.request && "is-centered",
              )}
            >
              <header>
                <div>
                  <span className="chief-overview-agent-icon">
                    {currentActionInProgress ? (
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
                      {currentActionInProgress
                        ? "Task in progress"
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
              </header>
              <div className="chief-overview-action-copy">
                <h2>
                  {deploymentRecovery ? "Connect Chief" : currentAction.title}
                </h2>
                <p>
                  {deploymentRecovery
                    ? "Chief's previous cloud deployment no longer exists. Choose where Chief should run, then your scheduled work can continue."
                    : currentAction.reason.trim() ||
                      "This action needs your review."}
                </p>
                {currentActionTask?.status === "needs_approval" ? (
                  <OverviewTaskInput
                    key={currentActionTask.id}
                    task={currentActionTask}
                  />
                ) : null}
                {currentAction.request &&
                !isGoogleAnalyticsConnectionAction(currentAction) ? (
                  <div className="chief-overview-setup-input">
                    <InputRequestSection
                      key={currentAction.request.id}
                      request={currentAction.request}
                      embedded
                      onSubmit={(request, values, answers) => {
                        if (currentAction.sourceId) {
                          setContinuingChatId(currentAction.sourceId);
                        }
                        return workspaceData
                          .resolveActionRequest(
                            currentAction.id,
                            request.id,
                            answers,
                            values,
                          )
                          .catch((error) => {
                            setContinuingChatId(null);
                            throw error;
                          });
                      }}
                    />
                  </div>
                ) : null}
              </div>
              <footer>
                <div className="chief-overview-action-buttons">
                  {deploymentRecovery ? (
                    <>
                      <button type="button" onClick={useCodexLocally}>
                        Use Chief on this Mac
                      </button>
                      <button
                        type="button"
                        onClick={() => navigate("/agents?view=deploy")}
                      >
                        Deploy Chief
                      </button>
                    </>
                  ) : isGoogleAnalyticsConnectionAction(currentAction) ||
                    isOnboardingEngineeringAction(currentAction) ? (
                    <button type="button" onClick={() => openAction()}>
                      {isOnboardingEngineeringAction(currentAction)
                        ? `Connect ${nextEngineeringIntegration?.name ?? "tool"}`
                        : currentAction.request
                          ? "Continue setup"
                          : "Connect integration"}
                    </button>
                  ) : !currentAction.request ? (
                    <button type="button" onClick={resolveAction}>
                      {currentActionBlocked
                        ? "Allow and retry"
                        : currentActionFailed
                          ? "Start again"
                          : currentActionInProgress
                            ? "View task"
                            : "Review"}
                    </button>
                  ) : null}
                  {!currentActionInProgress &&
                  !currentAction.id.startsWith(
                    "onboarding-google-analytics-recovery-",
                  ) &&
                  !isOnboardingEngineeringAction(currentAction) ? (
                    <button
                      type="button"
                      aria-keyshortcuts="E"
                      onClick={() =>
                        workspaceData.dismissActionItem(currentAction.id)
                      }
                      title="Dismiss (E)"
                    >
                      Dismiss
                    </button>
                  ) : null}
                </div>
                <OverviewActionPagination
                  actions={overviewActions}
                  index={resolvedOverviewActionIndex}
                  onMove={moveAction}
                />
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
                  ? workspaceData.loading
                    ? "Checking the workspace…"
                    : continuingChatId
                      ? "Chief is on it."
                      : "Chief is learning your business."
                  : "You’re caught up."}
              </h2>
              <p>
                {preparingWorkspace
                  ? workspaceData.loading
                    ? "Chief is gathering the latest work from your agents."
                    : continuingChatId
                      ? "Chief is continuing the setup with the details you provided. Follow the work in the conversation."
                      : "Chief is reviewing your website, saved context and connected sources. You can leave this open; the work will continue."
                  : agentSchedules.length > 0
                    ? `Nothing needs your judgment. ${agentSchedules.length} recurring ${agentSchedules.length === 1 ? "task is" : "tasks are"} still active.`
                    : "Nothing needs your judgment. Choose recurring work when you’re ready to put the team in motion."}
              </p>
              <button
                className={continuingChatId ? "is-primary" : undefined}
                type="button"
                onClick={() =>
                  continuingChatId
                    ? navigate(
                        `/conversations?chat=${encodeURIComponent(continuingChatId)}`,
                      )
                    : navigate("/schedule")
                }
              >
                {continuingChatId ? "View Chief's work" : "View schedule"}{" "}
                <ArrowRight size={13} />
              </button>
            </article>
          )}

          {overviewActions.length > 1 ? (
            <nav
              aria-label="Choose an action item"
              className="chief-overview-action-queue"
            >
              {overviewActions.slice(0, 4).map((item, index) => (
                <button
                  className={
                    index === resolvedOverviewActionIndex ? "is-active" : ""
                  }
                  key={item.id}
                  onClick={() => setSelectedActionId(item.id)}
                  type="button"
                >
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <strong>{item.title}</strong>
                  <small>{AGENT_NAMES[item.agentId] ?? item.agentId}</small>
                </button>
              ))}
            </nav>
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
            <AnimatePresence initial={false} mode="wait">
              {activeAnalyticsSlide ? (
                <motion.article
                  animate={{ opacity: 1, x: 0 }}
                  className="chief-overview-analytics-slide"
                  exit={{ opacity: 0, x: prefersReducedMotion ? 0 : -8 }}
                  initial={{ opacity: 0, x: prefersReducedMotion ? 0 : 8 }}
                  key={activeAnalyticsSlide.id}
                  onClick={() => navigate("/analytics")}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    void navigate("/analytics");
                  }}
                  role="link"
                  tabIndex={0}
                  transition={{
                    duration: prefersReducedMotion ? 0 : 0.28,
                    ease: [0.22, 1, 0.36, 1],
                  }}
                >
                  <h2>{activeAnalyticsSlide.title}</h2>
                  <div className="chief-overview-analytics-value">
                    <strong>{activeAnalyticsSlide.value}</strong>
                    <span>{activeAnalyticsSlide.label}</span>
                    <Trend value={activeAnalyticsSlide.trend} />
                  </div>
                  {activeAnalyticsSlide.points ? (
                    <AnalyticsChart
                      label={activeAnalyticsSlide.label}
                      points={activeAnalyticsSlide.points}
                      reduceMotion={Boolean(prefersReducedMotion)}
                    />
                  ) : null}
                </motion.article>
              ) : null}
            </AnimatePresence>
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
                      item.kind === "active"
                        ? item.status === "completed"
                          ? "Complete"
                          : item.status === "failed"
                            ? "Needs attention"
                            : item.status === "waiting"
                              ? "Waiting for input"
                              : item.childId
                                ? "Specialist working"
                                : item.taskCount
                                  ? `${item.taskCount} ${item.taskCount === 1 ? "task" : "tasks"} in progress`
                                  : "Working now"
                        : item.onceAt === undefined
                          ? "Scheduled"
                          : "One-time task";
                    return (
                      <button
                        key={item.id}
                        ref={
                          item.id === focusedTimelineItemId
                            ? scheduleFocusRef
                            : undefined
                        }
                        onClick={() =>
                          navigate(
                            item.kind === "active"
                              ? item.parentId
                                ? `/conversations?chat=${encodeURIComponent(item.parentId)}${item.childId ? `&child=${encodeURIComponent(item.childId)}` : ""}`
                                : "/conversations"
                              : "/schedule",
                          )
                        }
                        type="button"
                      >
                        <time>
                          <strong>
                            {item.kind === "active" ? "Now" : when.day}
                          </strong>
                          <span>{when.time}</span>
                        </time>
                        <i
                          className={`is-${
                            item.kind === "upcoming"
                              ? "upcoming"
                              : item.status === "completed"
                                ? "completed"
                                : item.status === "failed"
                                  ? "failed"
                                  : item.status === "waiting"
                                    ? "upcoming"
                                    : "running"
                          }`}
                        >
                          {item.kind === "active" &&
                          item.status === "running" ? (
                            <LoaderCircle aria-hidden size={10} />
                          ) : null}
                        </i>
                        <span>
                          <strong>{item.title}</strong>
                          <small>
                            {state} ·{" "}
                            {AGENT_NAMES[item.agentId] ?? item.agentId}
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
        <ChatComposer
          className="pointer-events-auto w-full max-w-3xl"
          value={ask}
          onValueChange={setAsk}
          onSubmit={submit}
          execution={overviewExecution}
          onExecutionChange={setSelectedExecution}
        />
      </div>
    </div>
  );
}
