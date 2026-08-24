import { useEffect, useMemo, useState } from "react";

import type {
  AnalyticsDataset,
  AnalyticsDatasetPeriod,
  RecurringWorkRecord,
  SessionRecord,
} from "@chief/agent-runtime/types";
import { isJsonString } from "@chief/relay-contracts";

import type { useWorkspaceData } from "../lib/runtime";
import { formatNumber } from "../components/overview-presentation";

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

function percentageChange(current?: number, previous?: number) {
  if (current === undefined || previous === undefined || previous <= 0) {
    return null;
  }
  return ((current - previous) / previous) * 100;
}

function parseMetricKey(value: unknown) {
  return isJsonString(value)
    ? value.toLowerCase().replace(/[^a-z0-9]/g, "")
    : "";
}

function parseMetricLabel(value: unknown, fallback: string) {
  return isJsonString(value) && value.trim() ? value.toLowerCase() : fallback;
}

function periodMetric(
  period: AnalyticsDatasetPeriod | undefined,
  candidates: string[],
) {
  const accepted = new Set(candidates.map(parseMetricKey));
  return period?.values.find((item) =>
    accepted.has(parseMetricKey(item.metric)),
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

export function useDashboardInsights({
  analytics,
  analytics30,
  datasets,
  newProspects,
  preparationActive,
  preparationChildren,
  preparationRoot,
  prefersReducedMotion,
  previous30,
  scheduleById,
  workspaceData,
}: {
  analytics: AnalyticsDataset | undefined;
  analytics30: AnalyticsDatasetPeriod | undefined;
  datasets: AnalyticsDataset[] | undefined;
  newProspects: number;
  preparationActive: boolean;
  preparationChildren: SessionRecord[];
  preparationRoot: SessionRecord | undefined;
  prefersReducedMotion: boolean | null;
  previous30: AnalyticsDatasetPeriod | undefined;
  scheduleById: Map<string, RecurringWorkRecord>;
  workspaceData: ReturnType<typeof useWorkspaceData>;
}) {
  const [analyticsIndex, setAnalyticsIndex] = useState(0);
  const [analyticsPaused, setAnalyticsPaused] = useState(false);
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
            agentId: "chief",
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
      ["activeusers", "users", "sessions"].includes(parseMetricKey(metric.key)),
    );
    const signupMetric = analytics?.metrics.find((metric) =>
      ["conversions", "keyevents", "signups"].includes(
        parseMetricKey(metric.key),
      ),
    );
    const trafficSeries = analytics?.series?.find((series) =>
      ["activeusers", "users", "sessions"].includes(
        parseMetricKey(series.metric || series.id || series.label),
      ),
    );
    return [
      {
        id: "traffic",
        title: trendTitle("Traffic", trafficTrend, hasTraffic),
        value: datasets === undefined ? "—" : formatNumber(currentTraffic ?? 0),
        label: parseMetricLabel(trafficMetric?.label, "traffic"),
        trend: trafficTrend,
        points: chartPoints((trafficSeries?.points ?? []).slice(-14)),
      },
      {
        id: "signups",
        title: trendTitle("Signups", signupTrend, hasSignups),
        value: datasets === undefined ? "—" : formatNumber(currentSignups ?? 0),
        label: parseMetricLabel(signupMetric?.label, "tracked conversions"),
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

  const activeAnalyticsSlide =
    analyticsSlides[analyticsIndex] ?? analyticsSlides[0];
  return {
    activeAnalyticsSlide,
    agentWorkTimeline,
    analyticsIndex,
    analyticsSlides,
    moveAnalytics,
    selectAnalytics,
    setAnalyticsPaused,
  };
}
