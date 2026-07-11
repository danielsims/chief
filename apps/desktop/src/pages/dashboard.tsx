import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { useConvexAuth, useQuery } from "convex/react";
import { api } from "@marketer/backend/convex/_generated/api";
import { ArrowDownRight, ArrowUp, ArrowUpRight } from "lucide-react";
import { Button } from "@marketer/ui/components/button";
import { cn } from "@marketer/ui/lib/utils";
import { OrgLogo } from "../components/org-logo";
import { createChat } from "../lib/chat-log";
import { SetupProgress } from "../components/setup-progress";
import {
  RunReviewDialog,
  reviewFromAttention,
  type RunReview,
} from "../components/run-review-dialog";
import { useAuth } from "../lib/auth/auth-context";
import { useWorkspaceData } from "../lib/runtime";
import {
  listAuthOrganizations,
  parseOrganizationMetadata,
  type AuthOrganization,
} from "../lib/auth/better-auth-client";

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
  rangeMetrics?: Array<{
    key: string;
    period: string;
    activeUsers?: number;
    pageViews?: number;
    conversions?: number;
  }>;
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
          <span className="text-xs text-muted-foreground">{org.name}</span>
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
  const { cloudOrganizationId } = useAuth();
  const convexAuth = useConvexAuth();
  const canQuery = convexAuth.isAuthenticated && Boolean(cloudOrganizationId);
  const snapshots = useQuery(
    api.analyticsSnapshots.listLatest,
    canQuery ? {} : "skip",
  ) as DashboardSnapshot[] | undefined;
  const workspaceData = useWorkspaceData(cloudOrganizationId);
  const scheduledCount = workspaceData.drafts.filter(
    (draft) =>
      draft.status === "scheduled" &&
      draft.scheduledFor !== undefined &&
      draft.scheduledFor >= Date.now(),
  ).length;
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
  const widgets = [
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
      label: "Action items",
      value: workspaceData.loading
        ? "—"
        : formatNumber(workspaceData.attentionItems.length),
      detail:
        workspaceData.attentionItems.length > 0
          ? "Agents need your input"
          : "Nothing flagged by agents",
      trend: null,
      to: "/conversations?agent=cmo",
    },
    {
      label: "New prospects",
      value: workspaceData.loading ? "—" : formatNumber(newProspects),
      detail: newProspects > 0 ? "Ready to review" : "No new prospects yet",
      trend: null,
      to: "/prospects",
    },
    {
      label: "Trending topics",
      value: workspaceData.loading ? "—" : formatNumber(newTrends),
      detail: newTrends > 0 ? "New signals surfaced" : "No topics surfaced yet",
      trend: null,
      to: "/trending",
    },
    {
      label: "Scheduled posts",
      value: workspaceData.loading ? "—" : formatNumber(scheduledCount),
      detail: scheduledCount > 0 ? "Upcoming content" : "Nothing scheduled",
      trend: null,
      to: "/schedule",
    },
  ];

  const recentRuns = useMemo(() => {
    const since = Date.now() - 24 * 60 * 60 * 1000;
    const works = new Map(
      workspaceData.recurringWork.map((work) => [work.id, work]),
    );
    return workspaceData.recurringWorkRuns
      .filter((run) => run.status !== "running" && run.startedAt >= since)
      .sort((a, b) => b.startedAt - a.startedAt)
      .slice(0, 5)
      .map((run) => ({
        ...run,
        title: works.get(run.recurringWorkId)?.title ?? "Automation",
        agentId: works.get(run.recurringWorkId)?.agentId ?? "cmo",
      }));
  }, [workspaceData.recurringWork, workspaceData.recurringWorkRuns]);
  const attention = workspaceData.attentionItems;
  const showDigest = attention.length > 0 || recentRuns.length > 0;
  const [review, setReview] = useState<RunReview | null>(null);
  const [hasSetup, setHasSetup] = useState(false);
  const [overviewTab, setOverviewTab] = useState<"review" | "setup">("review");
  const showTabs = showDigest && hasSetup;
  const openRunReview = (run: (typeof recentRuns)[number]) => {
    const attentionItem = attention.find(
      (item) => item.sourceId === `automation-${run.recurringWorkId}`,
    );
    setReview({
      title: run.title,
      agentId: run.agentId,
      recurringWorkId: run.recurringWorkId,
      attentionItemId: attentionItem?.id,
      detail: run.summary ?? run.error ?? "No summary was recorded.",
      status: run.status,
      at: run.startedAt,
      blockedTools: run.blockedTools ?? [],
    });
  };

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
        <p className="mt-2 text-sm text-muted-foreground">
          An overview of your channels and agents.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {widgets.map((w) => (
          <button
            key={w.label}
            onClick={() => navigate(w.to)}
            className="flex min-h-[110px] flex-col justify-between border bg-card p-5 text-left transition-all duration-300 hover:bg-accent"
          >
            <span className="text-xs text-muted-foreground">{w.label}</span>
            <span>
              <span className="flex items-center gap-2">
                <span className="block text-xl font-medium">{w.value}</span>
                {w.trend !== null && w.trend !== undefined ? (
                  <Trend value={w.trend} />
                ) : null}
              </span>
              <span className="text-xs text-muted-foreground">{w.detail}</span>
            </span>
          </button>
        ))}
      </div>

      {showTabs ? (
        <div className="flex justify-center">
          <div className="flex border p-0.5">
            {(
              [
                { key: "review", label: "Review" },
                { key: "setup", label: "Setup" },
              ] as const
            ).map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setOverviewTab(tab.key)}
                className={
                  overviewTab === tab.key
                    ? "bg-accent px-3 py-1.5 text-xs text-foreground"
                    : "px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
                }
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {showDigest && (!showTabs || overviewTab === "review") ? (
        <section className="border bg-card">
          <div className="border-b px-5 py-3">
            <p className="text-sm font-medium">While you were away</p>
          </div>
          {attention.length > 0 ? (
            <div className="divide-y border-b">
              {attention.map((item) => (
                <div key={item.id} className="flex items-start gap-3 px-5 py-3">
                  <span className="mt-1.5 size-1.5 shrink-0 bg-amber-400" />
                  <button
                    type="button"
                    onClick={() =>
                      setReview(
                        reviewFromAttention(
                          item,
                          workspaceData.recurringWorkRuns,
                        ),
                      )
                    }
                    className="min-w-0 flex-1 text-left"
                  >
                    <p className="text-sm font-medium">{item.title}</p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      {item.reason}
                    </p>
                  </button>
                  <div className="flex shrink-0 items-center gap-2 pt-0.5">
                    <button
                      type="button"
                      onClick={() =>
                        setReview(
                          reviewFromAttention(
                            item,
                            workspaceData.recurringWorkRuns,
                          ),
                        )
                      }
                      className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                    >
                      Review
                    </button>
                    <button
                      type="button"
                      onClick={() => workspaceData.dismissAttentionItem(item.id)}
                      className="text-xs text-muted-foreground hover:text-foreground"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
          {recentRuns.length > 0 ? (
            <div className="divide-y">
              {recentRuns.map((run) => (
                <button
                  key={run.id}
                  type="button"
                  onClick={() => openRunReview(run)}
                  className="flex w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-accent"
                >
                  <span
                    className={
                      run.status === "completed"
                        ? "size-1.5 shrink-0 bg-emerald-500"
                        : run.status === "failed"
                          ? "size-1.5 shrink-0 bg-destructive"
                          : "size-1.5 shrink-0 bg-amber-400"
                    }
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{run.title}</span>
                    {run.summary ? (
                      <span className="mt-0.5 line-clamp-2 block text-xs leading-5 text-muted-foreground">
                        {run.summary}
                      </span>
                    ) : null}
                  </span>
                  <span className="shrink-0 text-[10px] text-muted-foreground">
                    {new Date(run.startedAt).toLocaleTimeString([], {
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </span>
                </button>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      <div
        className={
          showTabs && overviewTab !== "setup" ? "hidden" : undefined
        }
      >
        <SetupProgress onVisibilityChange={setHasSetup} />
      </div>

      <RunReviewDialog
        review={review}
        onClose={() => setReview(null)}
        onDismiss={(target) => {
          if (target.attentionItemId) {
            workspaceData.dismissAttentionItem(target.attentionItemId);
          }
        }}
        onAllowAndRerun={(target) => {
          if (target.recurringWorkId) {
            workspaceData.expandRecurringWorkGrant(
              target.recurringWorkId,
              target.blockedTools,
              true,
            );
          }
        }}
      />

      <div className="mx-auto w-full max-w-[680px]">
        <div className="border bg-card/80 backdrop-blur-lg">
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
            className="w-full resize-none bg-transparent px-3 pt-3 text-sm leading-6 outline-none placeholder:text-muted-foreground"
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
