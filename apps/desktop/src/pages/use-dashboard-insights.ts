import { useMemo } from "react";

import type {
  AnalyticsDataset,
  AnalyticsDatasetPeriod,
  SessionRecord,
} from "@chief/agent-runtime/types";
import { isJsonString } from "@chief/relay-contracts";

import type { useWorkspaceData } from "../lib/runtime";
import { formatNumber } from "../components/overview-presentation";
import { useAuth } from "../lib/auth/auth-context";
import { useWorkspaceFiles } from "../lib/runtime";

/** A real number worth a glance, shown only when there is data behind it. */
export interface DashboardHighlight {
  id: string;
  value: string;
  label: string;
  trend: number | null;
  destination: string;
}

/** Something an agent produced recently. */
export interface DashboardOutput {
  id: string;
  title: string;
  agentId: string | undefined;
  updatedAt: number;
  destination: string;
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
  threadRootId?: string;
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

export function useDashboardInsights({
  analytics,
  analytics30,
  newProspects,
  preparationActive,
  preparationChildren,
  preparationRoot,
  previous30,
  workspaceData,
}: {
  analytics: AnalyticsDataset | undefined;
  analytics30: AnalyticsDatasetPeriod | undefined;
  newProspects: number;
  preparationActive: boolean;
  preparationChildren: SessionRecord[];
  preparationRoot: SessionRecord | undefined;
  previous30: AnalyticsDatasetPeriod | undefined;
  workspaceData: ReturnType<typeof useWorkspaceData>;
}) {
  const { cloudOrganizationId } = useAuth();
  const { files } = useWorkspaceFiles(cloudOrganizationId);
  const agentWorkTimeline = useMemo<AgentWorkTimelineItem[]>(() => {
    const activeTasks = workspaceData.activity.filter(
      (session) =>
        session.kind === "task" &&
        session.status === "running" &&
        workspaceData.now - session.updatedAt < 10 * 60_000 &&
        (!preparationActive || session.parentId !== preparationRoot?.id),
    );
    const scheduledActive = activeTasks.slice(0, 4).map((task) => ({
      id: task.id,
      kind: "active" as const,
      timestamp: task.startedAt ?? task.createdAt,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      title: task.title,
      agentId: task.agent,
      parentId: task.parentId,
      threadRootId: task.triggerId,
      status: task.status,
    }));
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
    workspaceData.activity,
    workspaceData.now,
    workspaceData.recurringWork,
  ]);
  const highlights = useMemo<DashboardHighlight[]>(() => {
    const traffic = ["activeUsers", "users", "sessions"];
    const signups = ["conversions", "keyEvents", "signups"];
    const currentTraffic = periodMetric(analytics30, traffic);
    const currentSignups = periodMetric(analytics30, signups);
    const trafficMetric = analytics?.metrics.find((metric) =>
      ["activeusers", "users", "sessions"].includes(parseMetricKey(metric.key)),
    );
    const signupMetric = analytics?.metrics.find((metric) =>
      ["conversions", "keyevents", "signups"].includes(
        parseMetricKey(metric.key),
      ),
    );
    return [
      ...(currentTraffic === undefined
        ? []
        : [
            {
              id: "traffic",
              value: formatNumber(currentTraffic),
              label: parseMetricLabel(trafficMetric?.label, "visitors"),
              trend: percentageChange(
                currentTraffic,
                periodMetric(previous30, traffic),
              ),
              destination: "/analytics",
            },
          ]),
      ...(currentSignups === undefined
        ? []
        : [
            {
              id: "signups",
              value: formatNumber(currentSignups),
              label: parseMetricLabel(signupMetric?.label, "signups"),
              trend: percentageChange(
                currentSignups,
                periodMetric(previous30, signups),
              ),
              destination: "/analytics",
            },
          ]),
      ...(newProspects > 0
        ? [
            {
              id: "prospects",
              value: formatNumber(newProspects),
              label: newProspects === 1 ? "new prospect" : "new prospects",
              trend: null,
              destination: "/prospects",
            },
          ]
        : []),
    ];
  }, [analytics, analytics30, newProspects, previous30]);

  const recentOutputs = useMemo<DashboardOutput[]>(
    () =>
      files
        .filter((file) => file.createdBy === "agent")
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, 4)
        .map((file) => ({
          id: file.id,
          title: file.name,
          agentId: file.sourceAgentId,
          updatedAt: file.updatedAt,
          destination: `/files/${encodeURIComponent(file.id)}`,
        })),
    [files],
  );

  return { agentWorkTimeline, highlights, recentOutputs };
}
