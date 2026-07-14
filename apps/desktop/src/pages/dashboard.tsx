import { useEffect, useRef, useState } from "react";
import { useConvexAuth, useQuery } from "convex/react";
import { ArrowDownRight, ArrowUp, ArrowUpRight } from "lucide-react";
import { useNavigate } from "react-router";

import { api } from "@chief/backend/convex/_generated/api";
import { Button } from "@chief/ui/components/button";
import { cn } from "@chief/ui/lib/utils";

import type { AuthOrganization } from "../lib/auth/better-auth-client";
import { OrgLogo } from "../components/org-logo";
import { SetupProgress } from "../components/setup-progress";
import { useAuth } from "../lib/auth/auth-context";
import {
  listAuthOrganizations,
  parseOrganizationMetadata,
} from "../lib/auth/better-auth-client";
import { createChat } from "../lib/chat-log";
import {
  buildOnboardingSchedules,
  buildScheduleProvisioningJob,
  onboardingSchedulePlanFromMetadata,
} from "../lib/onboarding-schedules";
import { useWorkspaceData } from "../lib/runtime";
import { buildWorkspaceContext } from "../lib/workspace-context";

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

interface DashboardSnapshot {
  provider: string;
  period: string;
  activeUsers?: number;
  pageViews?: number;
  conversions?: number;
  rangeMetrics?: {
    key: string;
    period: string;
    activeUsers?: number;
    pageViews?: number;
    conversions?: number;
  }[];
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

function Trend({ value }: { value: number }) {
  const positive = value >= 0;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 text-[11px]",
        positive ? "text-emerald-500" : "text-red-500",
      )}
    >
      {positive ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
      {Math.abs(value).toFixed(1)}%
    </span>
  );
}

/**
 * Small workspace anchor above the greeting so multi-company users can tell
 * at a glance which company they are looking at.
 */
function WorkspaceIndicator() {
  const { cloudOrganizationId } = useAuth();
  const [org, setOrg] = useState<AuthOrganization | null>(null);

  useEffect(() => {
    let cancelled = false;
    void listAuthOrganizations().then((orgs) => {
      if (cancelled) return;
      setOrg(
        orgs.find((candidate) => candidate.id === cloudOrganizationId) ??
          orgs[0] ??
          null,
      );
    });
    return () => {
      cancelled = true;
    };
  }, [cloudOrganizationId]);

  const metadata = org ? parseOrganizationMetadata(org) : {};

  return (
    <div className="mb-5 flex h-7 items-center justify-center gap-2.5">
      {org ? (
        <>
          <OrgLogo
            name={org.name}
            logo={org.logo}
            website={
              typeof metadata.websiteUrl === "string" ? metadata.websiteUrl : ""
            }
            className="h-7 w-7 shrink-0 text-sm"
          />
          <span className="text-muted-foreground text-xs">{org.name}</span>
        </>
      ) : (
        <span className="h-7" aria-hidden="true" />
      )}
    </div>
  );
}

export function DashboardPage() {
  const navigate = useNavigate();
  const [ask, setAsk] = useState("");
  const [organization, setOrganization] = useState<AuthOrganization | null>(
    null,
  );
  const scheduleRecoveryAttempted = useRef(false);
  const { cloudOrganizationId } = useAuth();
  const convexAuth = useConvexAuth();
  const canQuery = convexAuth.isAuthenticated && Boolean(cloudOrganizationId);
  const snapshots = useQuery(
    api.analyticsSnapshots.listLatest,
    canQuery ? {} : "skip",
  ) as DashboardSnapshot[] | undefined;
  const workspaceData = useWorkspaceData(cloudOrganizationId);
  const agentSchedules = workspaceData.recurringWork.filter(
    (work) =>
      work.runOnceAt === undefined &&
      (work.status === "active" || work.status === "draft"),
  );
  const activeAgentSchedules = agentSchedules.filter(
    (work) => work.status === "active",
  );
  const nextAgentRun = activeAgentSchedules
    .map((work) => work.nextRunAt)
    .filter((value): value is number => typeof value === "number")
    .sort((a, b) => a - b)[0];
  const newProspects = workspaceData.prospects.filter(
    (prospect) => prospect.status === "new",
  ).length;
  const newTrends = workspaceData.trends.filter(
    (trend) => trend.status === "new",
  ).length;
  const analytics = snapshots?.find(
    (snapshot) => snapshot.provider === "google-analytics",
  );
  const analytics30 =
    analytics?.rangeMetrics?.find((range) => range.key === "30d") ?? analytics;
  const previous30 = analytics?.rangeMetrics?.find(
    (range) => range.key === "previous30d",
  );
  const attention = workspaceData.attentionItems;
  const onboardingWork = workspaceData.recurringWork.filter(
    (work) =>
      work.id.startsWith("onboarding-") &&
      work.runOnceAt !== undefined &&
      work.status === "active",
  );
  const onboardingWorkIds = new Set(onboardingWork.map((work) => work.id));
  const runningOnboardingRuns = workspaceData.recurringWorkRuns.filter(
    (run) =>
      run.status === "running" && onboardingWorkIds.has(run.recurringWorkId),
  );
  const currentOnboardingRun = runningOnboardingRuns
    .slice()
    .sort((a, b) => b.startedAt - a.startedAt)[0];
  const currentOnboardingWork = currentOnboardingRun
    ? onboardingWork.find(
        (work) => work.id === currentOnboardingRun.recurringWorkId,
      )
    : onboardingWork.slice().sort((a, b) => {
        return (
          (a.nextRunAt ?? a.runOnceAt ?? 0) - (b.nextRunAt ?? b.runOnceAt ?? 0)
        );
      })[0];

  useEffect(() => {
    let cancelled = false;
    void listAuthOrganizations().then((organizations) => {
      if (cancelled) return;
      setOrganization(
        organizations.find(
          (candidate) => candidate.id === cloudOrganizationId,
        ) ??
          organizations[0] ??
          null,
      );
    });
    return () => {
      cancelled = true;
    };
  }, [cloudOrganizationId]);

  useEffect(() => {
    scheduleRecoveryAttempted.current = false;
  }, [cloudOrganizationId]);

  useEffect(() => {
    if (
      !organization ||
      !cloudOrganizationId ||
      organization.id !== cloudOrganizationId ||
      workspaceData.loading ||
      scheduleRecoveryAttempted.current
    ) {
      return;
    }
    scheduleRecoveryAttempted.current = true;
    const metadata = parseOrganizationMetadata(organization);
    const onboarding =
      metadata.onboarding && typeof metadata.onboarding === "object"
        ? (metadata.onboarding as Record<string, unknown>)
        : null;
    const plan = onboardingSchedulePlanFromMetadata(onboarding?.automation);
    if (!plan) return;
    const missing = buildOnboardingSchedules(plan).filter(
      (schedule) =>
        !workspaceData.recurringWork.some((work) => work.id === schedule.id),
    );
    if (missing.length === 0) return;
    const provisioningJob = buildScheduleProvisioningJob(plan);
    void buildWorkspaceContext(cloudOrganizationId).then((workspaceContext) =>
      workspaceData.bootstrapOnboardingWork(
        provisioningJob ? [provisioningJob] : [],
        missing,
        workspaceContext,
      ),
    );
  }, [cloudOrganizationId, organization, workspaceData]);

  interface Widget {
    label: string;
    value: string;
    detail: string;
    trend: number | null;
    to: string;
    onClick?: () => void;
    indicator?: boolean;
  }
  // Agents flagged something: the card moves to the front and opens the
  // prioritized return-to-work inbox rather than dropping into a chat.
  const actionItems: Widget = {
    label: "Action items",
    value: workspaceData.loading ? "—" : formatNumber(attention.length),
    detail:
      attention.length > 0
        ? attention[0]!.title
        : onboardingWork.length > 0
          ? "Agents will flag anything they need"
          : "Nothing flagged by agents",
    trend: null,
    to: attention[0]
      ? `/schedule/history?attention=${attention[0].id}`
      : "/schedule/history",
    indicator: attention.length > 0,
  };
  const onboardingActivity: Widget | null = currentOnboardingWork
    ? {
        label: "Agents getting started",
        value: formatNumber(onboardingWork.length),
        detail: currentOnboardingRun
          ? `${currentOnboardingWork.title} is running`
          : `${currentOnboardingWork.title} starts shortly`,
        trend: null,
        to: currentOnboardingRun
          ? `/schedule/history?run=${encodeURIComponent(currentOnboardingRun.id)}`
          : "/schedule",
        indicator: true,
      }
    : null;
  const widgets: Widget[] = [
    actionItems,
    {
      label: "Website traffic",
      value:
        snapshots === undefined
          ? "—"
          : formatNumber(analytics30?.activeUsers ?? 0),
      detail:
        snapshots === undefined
          ? "Loading analytics…"
          : analytics30
            ? `${formatNumber(analytics30.pageViews ?? 0)} page views · ${analytics30.period}`
            : "No analytics report yet",
      trend: percentageChange(
        analytics30?.activeUsers,
        previous30?.activeUsers,
      ),
      to: "/analytics",
    },
    {
      label: "Signups",
      value:
        snapshots === undefined
          ? "—"
          : formatNumber(analytics30?.conversions ?? 0),
      detail:
        snapshots === undefined
          ? "Loading analytics…"
          : analytics30
            ? `Tracked conversions · ${analytics30.period}`
            : "No conversion data yet",
      trend: percentageChange(
        analytics30?.conversions,
        previous30?.conversions,
      ),
      to: "/analytics",
    },
    {
      label: "New prospects",
      value: workspaceData.loading ? "—" : formatNumber(newProspects),
      detail: newProspects > 0 ? "Ready to review" : "No new prospects yet",
      trend: null,
      to: "/prospects",
    },
    onboardingActivity ?? {
      label: "Trending topics",
      value: workspaceData.loading ? "—" : formatNumber(newTrends),
      detail: newTrends > 0 ? "New signals surfaced" : "No topics surfaced yet",
      trend: null,
      to: "/trending",
    },
    {
      label: "Agent schedules",
      value: workspaceData.loading ? "—" : formatNumber(agentSchedules.length),
      detail:
        agentSchedules.length === 0
          ? "No recurring work yet"
          : nextAgentRun
            ? `Next run ${new Date(nextAgentRun).toLocaleString([], {
                weekday: "short",
                hour: "numeric",
                minute: "2-digit",
              })}`
            : `${agentSchedules.length} ready to review`,
      trend: null,
      to: "/schedule",
    },
  ];

  const submit = () => {
    const text = ask.trim();
    if (!text) return;
    const conversation = createChat("cmo", text);
    navigate(
      `/conversations?agent=cmo&chat=${conversation.id}&new=1&prompt=${encodeURIComponent(text)}`,
    );
  };

  return (
    <div className="mx-auto flex min-h-[calc(100vh-120px)] max-w-3xl flex-col justify-center gap-10">
      <div className="text-center">
        <WorkspaceIndicator />
        <h1 className="font-serif text-[38px] leading-tight">
          {greeting()}
          <span className="text-muted-foreground">, Daniel</span>
        </h1>
        <p className="text-muted-foreground mt-2 text-sm">
          An overview of your channels and agents.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {widgets.map((w) => (
          <button
            key={w.label}
            onClick={w.onClick ?? (() => navigate(w.to))}
            className="bg-card hover:bg-accent flex min-h-[110px] flex-col justify-between border p-5 text-left transition-all duration-300"
          >
            <span className="text-muted-foreground flex items-center gap-1.5 text-xs">
              {w.label}
              {w.indicator ? (
                <span className="size-1.5 animate-pulse bg-amber-400" />
              ) : null}
            </span>
            <span>
              <span className="flex items-center gap-2">
                <span className="block text-xl font-medium">{w.value}</span>
                {w.trend !== null && w.trend !== undefined ? (
                  <Trend value={w.trend} />
                ) : null}
              </span>
              <span className="text-muted-foreground text-xs">{w.detail}</span>
            </span>
          </button>
        ))}
      </div>

      <SetupProgress />

      <div className="mx-auto w-full max-w-[680px]">
        <div className="bg-card/80 border backdrop-blur-lg">
          <textarea
            value={ask}
            onChange={(e) => setAsk(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder="Ask your CMO…"
            rows={1}
            className="placeholder:text-muted-foreground w-full resize-none bg-transparent px-3 pt-3 text-sm leading-6 outline-none"
          />
          <div className="flex items-center justify-end px-3 pb-2">
            <Button size="icon" className="h-7 w-7" onClick={submit}>
              <ArrowUp size={14} />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
