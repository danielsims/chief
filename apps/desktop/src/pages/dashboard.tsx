/* eslint-disable max-lines */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  Check,
  ChevronLeft,
  ChevronRight,
  LoaderCircle,
} from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useNavigate } from "react-router";

import type {
  ActionItem,
  AnalyticsDataset,
  AnalyticsDatasetPeriod,
  SessionRecord,
} from "@chief/agent-runtime/types";
import { cn } from "@chief/ui/lib/utils";

import type { ComposerImageAttachment } from "../components/chat/composer-image-attachments";
import type { OverviewAction } from "../components/overview-presentation";
import type { AuthOrganization } from "../lib/auth/better-auth-client";
import { ChatComposer } from "../components/chat/chat-composer";
import { createComposerHandoff } from "../components/chat/composer-handoff";
import { InputRequestSection } from "../components/integrations/input-request-section";
import {
  AnalyticsChart,
  formatNumber,
  OverviewActionPagination,
  overviewButton,
  Trend,
  WorkspaceIndicator,
  WorkspaceLearningCard,
} from "../components/overview-presentation";
import { PageTitle } from "../components/page-title";
import { setAgentOverride, setWorkspaceProvider } from "../lib/agent-overrides";
import { useAuth } from "../lib/auth/auth-context";
import {
  cachedAuthOrganization,
  listAuthOrganizations,
} from "../lib/auth/better-auth-client";
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
import { useLocalIntegrationStatus } from "../lib/local-integration-status";
import {
  isOnboardingEngineeringAction,
  onboardingEngineeringSetup,
  selectedGoogleAnalyticsDuringOnboarding,
} from "../lib/onboarding-engineering";
import {
  useAgentPreferences,
  useObservedChat,
  useWorkspaceData,
} from "../lib/runtime";
import {
  actionConversation,
  channelChatId,
  GETTING_STARTED_CHANNEL_RELAY_ID,
  WORKSPACE_AGENT_IDENTITIES,
} from "../lib/workspace-channels";

const AGENT_NAMES: Record<string, string> = {
  ads: "Ads Manager",
  analyst: "Analyst",
  brand: "Brand Researcher",
  cmo: "Chief Marketing Officer",
  content: "Content Writer",
  prospector: "Prospector",
  setup: "Setup",
};

const LEARNING_ACTION_ID = "workspace-getting-started";

const OVERVIEW_MENTION_CANDIDATES = Object.entries(WORKSPACE_AGENT_IDENTITIES)
  .filter(([id]) => id !== "setup")
  .map(([id, identity]) => ({
    id,
    ...identity,
    member: id === "cmo",
  }));

const overviewSurface =
  "bg-card rounded-2xl shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_8%,transparent),inset_0_1px_0_rgba(255,255,255,0.045),0_8px_24px_rgba(0,0,0,0.025)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.055),inset_0_1px_0_rgba(255,255,255,0.035)]";

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
      <p className="text-muted-foreground mt-4 animate-pulse text-xs">
        Loading the task request…
      </p>
    );
  }
  if (!pendingInput) return null;

  return (
    <div className="mt-4 flex min-h-44 flex-1 [scrollbar-gutter:stable] overflow-y-auto overscroll-contain [&>div]:min-h-full [&>div]:w-full [&>div]:p-4">
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
  const [askAttachments, setAskAttachments] = useState<
    ComposerImageAttachment[]
  >([]);
  const { cloudOrganizationId, user } = useAuth();
  const [organization, setOrganization] = useState<AuthOrganization | null>(
    () => cachedAuthOrganization(cloudOrganizationId),
  );
  const [selectedActionId, setSelectedActionId] = useState<string | null>(null);
  const [continuingChatId, setContinuingChatId] = useState<string | null>(null);
  const [analyticsIndex, setAnalyticsIndex] = useState(0);
  const [analyticsPaused, setAnalyticsPaused] = useState(false);
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
  const gettingStartedOpenedAt = cloudOrganizationId
    ? Number(
        sessionStorage.getItem(`chief:getting-started:${cloudOrganizationId}`),
      )
    : Number.NaN;
  const gettingStartedPending = Boolean(
    Number.isFinite(gettingStartedOpenedAt) &&
    workspaceData.now - gettingStartedOpenedAt < 10 * 60_000 &&
    (!preparationRoot || preparationRoot.status === "idle"),
  );
  const showLearningCard = gettingStartedPending || preparationActive;
  const overviewActions = useMemo<OverviewAction[]>(
    () => [
      ...(showLearningCard
        ? [
            {
              id: LEARNING_ACTION_ID,
              title: "Finish setting up with Chief",
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
      sessionStorage.removeItem(`chief:getting-started:${cloudOrganizationId}`);
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
    if (
      isOnboardingEngineeringAction(action) &&
      nextEngineeringIntegration &&
      cloudOrganizationId
    ) {
      localStorage.setItem(
        `chief:integration-setup:${nextEngineeringIntegration.domain}`,
        "active",
      );
      void navigate(
        `/conversations?chat=${encodeURIComponent(
          integrationSetupChatId(
            cloudOrganizationId,
            nextEngineeringIntegration.domain,
          ),
        )}&dm=setup`,
      );
      return;
    }
    if (
      isGoogleAnalyticsConnectionAction(action) &&
      isOnboardingGoogleAnalyticsAction(action.id)
    ) {
      void navigate(
        `/conversations?chat=${encodeURIComponent(googleAnalyticsActionChatId(action.id))}&dm=setup`,
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
      const prompt =
        `Help me complete “${action.title}”. ${action.reason.trim()}`.trim();
      void navigate(
        `/conversations?dm=setup&prompt=${encodeURIComponent(prompt)}`,
      );
      return;
    }
    if (
      privateTasksById.get(action.sourceId ?? "")?.scheduleId ||
      action.sourceId?.startsWith("automation-")
    ) {
      void navigate("/schedule");
      return;
    }
    const destination = actionConversation(action);
    const prompt =
      `Please action “${action.title}”. ${action.reason.trim()}`.trim();
    const params = new URLSearchParams({ prompt });
    params.set(destination.kind, destination.id);
    void navigate(`/conversations?${params.toString()}`);
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
    if (!text && askAttachments.length === 0) return;
    const handoff = createComposerHandoff({
      text,
      attachments: askAttachments,
    });
    const params = new URLSearchParams({
      dm: "cmo",
      handoff,
    });
    void navigate(`/conversations?${params.toString()}`);
  };

  const profileFirstName = user?.name.trim().split(/\s+/)[0];
  const firstName = profileFirstName ?? "there";
  const preparingWorkspace =
    workspaceData.loading ||
    gettingStartedPending ||
    preparationActive ||
    Boolean(continuingChatId);
  const activeAnalyticsSlide =
    analyticsSlides[analyticsIndex] ?? analyticsSlides[0];

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-[1120px] flex-col overflow-hidden pt-3 pb-[176px] max-[760px]:h-auto max-[760px]:overflow-visible max-[760px]:pb-[250px]">
      <div className="flex min-h-0 flex-1 flex-col justify-center pt-6">
        <header className="mb-6 flex shrink-0 items-start justify-between gap-6 max-[760px]:flex-col">
          <div>
            <PageTitle size="overview">
              {greeting(workspaceData.now)}, {firstName}
            </PageTitle>
            <p className="text-muted-foreground mt-2 text-xs">
              An overview of your channels and agents.
            </p>
          </div>
          <WorkspaceIndicator organization={organization} />
        </header>

        <section className="grid max-h-[min(640px,calc(100vh-250px))] min-h-0 w-full flex-none grid-cols-[minmax(0,1.7fr)_minmax(310px,0.9fr)] gap-3.5 max-[930px]:grid-cols-[minmax(0,1fr)_300px] max-[760px]:max-h-none max-[760px]:grid-cols-1">
          <section
            className={cn(
              overviewSurface,
              "flex min-h-0 min-w-0 flex-col overflow-hidden",
            )}
            aria-label="Action items"
          >
            {learningSelected ? (
              <WorkspaceLearningCard
                actions={overviewActions}
                index={resolvedOverviewActionIndex}
                onMove={moveAction}
                reviewChatId={channelChatId(GETTING_STARTED_CHANNEL_RELAY_ID)}
                onOpen={() => {
                  void navigate(
                    `/conversations?channel=getting-started&chat=${encodeURIComponent(channelChatId(GETTING_STARTED_CHANNEL_RELAY_ID))}`,
                  );
                }}
              />
            ) : currentAction ? (
              <article
                className={cn(
                  "relative flex min-h-0 flex-1 flex-col p-7",
                  !currentAction.request && "justify-center",
                )}
              >
                <header className="flex items-start justify-between gap-3.5">
                  <div className="flex items-center gap-2.5">
                    {currentActionInProgress ? (
                      <LoaderCircle
                        className="text-muted-foreground animate-spin"
                        size={13}
                      />
                    ) : null}
                    <span className="grid gap-0.5">
                      <strong className="text-[12px] font-medium">
                        {AGENT_NAMES[currentAction.agentId] ??
                          currentAction.agentId}
                      </strong>
                      <small className="text-muted-foreground text-[10px]">
                        {currentActionInProgress
                          ? "Task in progress"
                          : `Prepared ${new Intl.RelativeTimeFormat(undefined, {
                              numeric: "auto",
                            }).format(
                              Math.max(
                                -30,
                                Math.round(
                                  (currentAction.createdAt -
                                    workspaceData.now) /
                                    86_400_000,
                                ),
                              ),
                              "day",
                            )}`}
                      </small>
                    </span>
                  </div>
                </header>
                <div
                  className={cn(
                    "my-10 max-w-[610px]",
                    currentAction.request &&
                      "mt-7 mb-5 flex min-h-0 w-full max-w-[680px] flex-1 flex-col",
                  )}
                >
                  <h2 className="m-0 text-[clamp(23px,2.7vw,33px)] leading-[1.1] font-normal tracking-[-0.035em]">
                    {deploymentRecovery ? "Connect Chief" : currentAction.title}
                  </h2>
                  <p className="text-muted-foreground mt-3 max-w-[560px] text-[13px] leading-6">
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
                    <div className="mt-4 flex min-h-44 flex-1 [scrollbar-gutter:stable] overflow-y-auto overscroll-contain [&>div]:min-h-full [&>div]:w-full [&>div]:p-4">
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
                <footer className="mt-auto flex items-center justify-between gap-4">
                  <div className="flex items-center gap-2">
                    {deploymentRecovery ? (
                      <>
                        <button
                          className={cn(
                            overviewButton,
                            "bg-foreground text-background hover:bg-foreground/90",
                          )}
                          type="button"
                          onClick={useCodexLocally}
                        >
                          Use Chief on this Mac
                        </button>
                        <button
                          className={overviewButton}
                          type="button"
                          onClick={() => navigate("/agents?view=deploy")}
                        >
                          Deploy Chief
                        </button>
                      </>
                    ) : isGoogleAnalyticsConnectionAction(currentAction) ||
                      isOnboardingEngineeringAction(currentAction) ? (
                      <button
                        className={cn(
                          overviewButton,
                          "bg-foreground text-background hover:bg-foreground/90",
                        )}
                        type="button"
                        onClick={() => openAction()}
                      >
                        {isOnboardingEngineeringAction(currentAction)
                          ? `Connect ${nextEngineeringIntegration?.name ?? "tool"}`
                          : currentAction.request
                            ? "Continue setup"
                            : "Connect integration"}
                      </button>
                    ) : !currentAction.request ? (
                      <button
                        className={cn(
                          overviewButton,
                          "bg-foreground text-background hover:bg-foreground/90",
                        )}
                        type="button"
                        onClick={resolveAction}
                      >
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
                        className={overviewButton}
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
              <article className="relative flex min-h-0 flex-1 flex-col items-start justify-center p-7">
                {preparingWorkspace ? (
                  <LoaderCircle
                    className="text-muted-foreground mb-6 animate-spin"
                    size={18}
                  />
                ) : (
                  <Check className="text-muted-foreground mb-6" size={18} />
                )}
                <h2 className="m-0 text-[clamp(24px,3vw,34px)] leading-tight font-normal tracking-[-0.03em]">
                  {preparingWorkspace
                    ? workspaceData.loading
                      ? "Checking the workspace…"
                      : continuingChatId
                        ? "Chief is on it."
                        : "Chief is learning your business."
                    : "You’re caught up."}
                </h2>
                <p className="text-muted-foreground mt-3 mb-6 max-w-[520px] text-[13px] leading-6">
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
                  className={cn(
                    overviewButton,
                    continuingChatId &&
                      "bg-foreground text-background hover:bg-foreground/90",
                  )}
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
                className="shadow-[inset_0_1px_0_color-mix(in_srgb,var(--foreground)_7%,transparent)]"
              >
                {overviewActions.slice(0, 4).map((item, index) => (
                  <button
                    className={cn(
                      "text-muted-foreground hover:text-foreground grid min-h-10 w-full grid-cols-[minmax(0,1fr)_120px] items-center gap-3 bg-transparent px-5 py-2 text-left shadow-[inset_0_1px_0_color-mix(in_srgb,var(--foreground)_6%,transparent)] transition-colors first:shadow-none hover:bg-black/[0.025] max-[930px]:grid-cols-1 dark:hover:bg-white/[0.03]",
                      index === resolvedOverviewActionIndex &&
                        "text-foreground bg-black/[0.025] dark:bg-white/[0.03]",
                    )}
                    key={item.id}
                    onClick={() => setSelectedActionId(item.id)}
                    type="button"
                  >
                    <strong className="min-w-0 truncate text-[12px] font-medium">
                      {item.title}
                    </strong>
                    <small className="truncate text-right text-[10px] max-[930px]:hidden">
                      {AGENT_NAMES[item.agentId] ?? item.agentId}
                    </small>
                  </button>
                ))}
              </nav>
            ) : null}
          </section>

          <aside className="grid min-h-0 min-w-0 grid-rows-[minmax(230px,1fr)_minmax(190px,1fr)] gap-2.5 max-[760px]:grid-cols-2 max-[760px]:grid-rows-none">
            <section
              aria-label="Workspace analytics"
              className={cn(
                overviewSurface,
                "relative min-w-0 overflow-visible",
              )}
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
                    className="absolute inset-0 cursor-pointer p-5 outline-none focus-visible:shadow-[inset_0_0_0_1px_var(--ring)]"
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
                    <h2 className="mt-10 max-w-[340px] text-[clamp(17px,1.8vw,23px)] leading-[1.12] font-normal tracking-[-0.025em]">
                      {activeAnalyticsSlide.title}
                    </h2>
                    <div className="mt-4 flex items-baseline gap-2">
                      <strong className="text-[22px] font-medium">
                        {activeAnalyticsSlide.value}
                      </strong>
                      <span className="text-muted-foreground text-[10px]">
                        {activeAnalyticsSlide.label}
                      </span>
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
              <div className="absolute right-3 bottom-2 z-[3] flex items-center gap-2">
                <button
                  aria-label="Previous analytics card"
                  onClick={() => moveAnalytics(-1)}
                  type="button"
                  className="text-muted-foreground hover:text-foreground grid size-7 place-items-center rounded-md"
                >
                  <ChevronLeft size={14} />
                </button>
                <span aria-label="Analytics cards" className="flex gap-1">
                  {analyticsSlides.map((slide, index) => (
                    <button
                      aria-label={`Show ${slide.label}`}
                      aria-pressed={index === analyticsIndex}
                      key={slide.id}
                      onClick={() => selectAnalytics(index)}
                      type="button"
                      className="grid h-3 w-3 place-items-center"
                    >
                      <i
                        className={cn(
                          "bg-border block h-0.5 w-3 rounded-full",
                          index === analyticsIndex && "bg-foreground",
                        )}
                      />
                    </button>
                  ))}
                </span>
                <button
                  aria-label="Next analytics card"
                  onClick={() => moveAnalytics(1)}
                  type="button"
                  className="text-muted-foreground hover:text-foreground grid size-7 place-items-center rounded-md"
                >
                  <ChevronRight size={14} />
                </button>
              </div>
            </section>

            <section
              className={cn(
                overviewSurface,
                "relative flex min-h-0 min-w-0 flex-col overflow-hidden p-4",
              )}
              aria-label="Agent work"
            >
              <header className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground text-[11px] font-medium">
                  Agent work
                </span>
                <button
                  className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-[10px] transition-colors"
                  onClick={() => navigate("/schedule")}
                  type="button"
                >
                  View schedule <ArrowRight size={11} />
                </button>
              </header>
              <div
                className="min-h-0 flex-1 [scrollbar-gutter:stable_both-edges] overflow-y-auto overscroll-contain pr-1"
                ref={scheduleScrollRef}
              >
                {agentWorkTimeline.length > 0 ? (
                  <div className="before:bg-foreground/[0.1] relative py-2 before:absolute before:top-8 before:bottom-8 before:left-[62px] before:w-px">
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
                          className="hover:bg-foreground/[0.025] grid min-h-12 w-full grid-cols-[48px_13px_minmax(0,1fr)_12px] items-center gap-2 rounded-lg px-1 text-left transition-colors"
                        >
                          <time className="grid min-w-0 gap-0.5">
                            <strong className="text-muted-foreground text-[10px] font-medium">
                              {item.kind === "active" ? "Now" : when.day}
                            </strong>
                            <span className="text-muted-foreground/70 text-[9px]">
                              {when.time}
                            </span>
                          </time>
                          <i
                            className={cn(
                              "bg-muted-foreground/60 relative z-[1] grid size-[7px] place-items-center justify-self-center rounded-full shadow-[0_0_0_3px_var(--card)]",
                              (item.kind === "upcoming" ||
                                item.status === "completed" ||
                                item.status === "waiting") &&
                                "bg-emerald-500",
                              item.status === "failed" && "bg-red-500",
                              item.kind === "active" &&
                                item.status === "running" &&
                                "bg-card text-foreground size-[15px]",
                            )}
                          >
                            {item.kind === "active" &&
                            item.status === "running" ? (
                              <LoaderCircle
                                aria-hidden
                                className="animate-spin"
                                size={10}
                              />
                            ) : null}
                          </i>
                          <span className="grid min-w-0 gap-0.5">
                            <strong className="truncate text-[11px] font-medium">
                              {item.title}
                            </strong>
                            <small className="text-muted-foreground/70 truncate text-[9px]">
                              {state} ·{" "}
                              {AGENT_NAMES[item.agentId] ?? item.agentId}
                            </small>
                          </span>
                          <ArrowRight
                            aria-hidden
                            className="text-muted-foreground/60"
                            size={10}
                          />
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-muted-foreground flex min-h-36 items-center justify-center text-center">
                    <span className="grid gap-1">
                      <strong className="text-foreground text-[11px] font-medium">
                        No upcoming work
                      </strong>
                      <small className="text-[10px]">
                        Your schedule is clear.
                      </small>
                    </span>
                  </div>
                )}
              </div>
            </section>
          </aside>
        </section>
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-40 flex flex-col items-center px-7 pb-5 before:absolute before:-inset-x-7 before:-top-16 before:-bottom-5 before:-z-10 before:bg-[linear-gradient(to_bottom,transparent,var(--background)_55%,var(--background))]">
        <ChatComposer
          className="pointer-events-auto w-full max-w-3xl"
          value={ask}
          onValueChange={setAsk}
          onSubmit={submit}
          imageAttachments={askAttachments}
          onImageAttachmentsChange={setAskAttachments}
          mentionCandidates={OVERVIEW_MENTION_CANDIDATES}
          showExecutionControls={false}
        />
      </div>
    </div>
  );
}
