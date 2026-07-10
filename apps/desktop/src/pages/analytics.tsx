import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAction, useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "@marketer/backend/convex/_generated/api";
import { Button } from "@marketer/ui/components/button";
import { cn } from "@marketer/ui/lib/utils";
import { BarChart3, RefreshCw, Sparkles } from "lucide-react";
import { useNavigate } from "react-router";
import { useAuth } from "../lib/auth/auth-context";
import { getWorkspaceProvider } from "../lib/agent-overrides";
import {
  SETUP_RESULT_MARKER,
  parseSetupResult,
  persistSetupResult,
  type AnalyticsSnapshotInput,
  type SetupIntegration,
  type SetupResult,
} from "../lib/integration-setup";
import {
  listAuthOrganizations,
  parseOrganizationMetadata,
} from "../lib/auth/better-auth-client";
import { useAgentChat, useRuntime } from "../lib/runtime";
import { IntegrationConnect } from "../components/integrations/integration-connect";
import { ConnectionPreview } from "../components/integrations/connection-preview";
import { ProviderLogo } from "../components/provider-logo";
import { createChat } from "../lib/chat-log";
import {
  GOOGLE_ANALYTICS_PROVIDER,
  providerDetails,
} from "../lib/provider-details";

interface AnalyticsChannel {
  _id: string;
  provider: string;
  category?: string;
  displayName: string;
  externalId?: string;
  lastSyncAt?: number;
}

interface ReportData extends AnalyticsSnapshotInput {
  capturedAt?: number;
}

const METRIC_RANGES = [
  { key: "7d", label: "7D" },
  { key: "14d", label: "14D" },
  { key: "30d", label: "30D" },
  { key: "3m", label: "3M" },
  { key: "1y", label: "1Y" },
] as const;

const fallbackAnalyticsIntegration: SetupIntegration = {
  domain: "analytics.googleapis.com",
  name: "Google Analytics",
};

function formatNumber(value: number) {
  return new Intl.NumberFormat(undefined, {
    notation: value > 9999 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(value);
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    notation: value > 9999 ? "compact" : "standard",
    maximumFractionDigits: value > 999 ? 1 : 2,
  }).format(value);
}

function MetricCell({
  label,
  value,
  period,
}: {
  label: string;
  value: string;
  period: string;
}) {
  return (
    <div className="min-h-[110px] border-r border-b p-4 last:border-r-0">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-3 text-2xl font-medium tracking-normal">{value}</p>
      <p className="mt-5 text-xs text-muted-foreground">{period}</p>
    </div>
  );
}

function AnalyticsLoadingState() {
  return (
    <div className="space-y-5 px-8 py-6" aria-busy="true">
      <div className="flex h-8 items-center justify-between">
        <span className="h-8 w-28 border bg-card" />
        <span className="h-8 w-24 border bg-card" />
      </div>
      <div className="h-[154px] border bg-card" />
      <div className="h-[274px] border bg-card" />
      <div className="h-[348px] border bg-card" />
    </div>
  );
}

function usePreferredAnalyticsIntegration(): SetupIntegration {
  const [integration, setIntegration] = useState<SetupIntegration>(
    fallbackAnalyticsIntegration,
  );
  const { cloudOrganizationId } = useAuth();

  useEffect(() => {
    let cancelled = false;
    void listAuthOrganizations().then((orgs) => {
      if (cancelled) return;
      const org =
        orgs.find((candidate) => candidate.id === cloudOrganizationId) ??
        orgs[0];
      if (!org) return;
      const metadata = parseOrganizationMetadata(org);
      const onboarding =
        metadata.onboarding && typeof metadata.onboarding === "object"
          ? (metadata.onboarding as Record<string, unknown>)
          : {};
      const analytics =
        onboarding.analytics && typeof onboarding.analytics === "object"
          ? (onboarding.analytics as Record<string, unknown>)
          : {};
      const integrations = Array.isArray(analytics.integrations)
        ? analytics.integrations
        : [];
      const chosen = integrations[0] as Record<string, unknown> | undefined;
      if (
        chosen &&
        typeof chosen.domain === "string" &&
        typeof chosen.name === "string"
      ) {
        setIntegration({ domain: chosen.domain, name: chosen.name });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [cloudOrganizationId]);

  return integration;
}

function reportFromResult(result: SetupResult): ReportData | null {
  const number = (key: string) =>
    typeof result[key] === "number" ? (result[key] as number) : undefined;
  const series = Array.isArray(result.series) ? result.series : undefined;
  const hasMetrics = [
    "activeUsers",
    "sessions",
    "pageViews",
    "conversions",
    "revenue",
  ].some((key) => number(key) !== undefined);
  if (!hasMetrics && !series?.length) return null;

  return {
    provider:
      result.provider === "analytics.googleapis.com"
        ? GOOGLE_ANALYTICS_PROVIDER
        : String(result.provider),
    period:
      typeof result.period === "string"
        ? result.period
        : series?.length
          ? `${series.length} D`
          : "30 D",
    activeUsers: number("activeUsers"),
    sessions: number("sessions"),
    pageViews: number("pageViews"),
    conversions: number("conversions"),
    revenue: number("revenue"),
    metricLabel:
      typeof result.metricLabel === "string" ? result.metricLabel : undefined,
    series,
  };
}

function snapshotArgs(report: ReportData): AnalyticsSnapshotInput {
  const periodKey =
    report.period === "7 D"
      ? "7d"
      : report.period === "14 D"
        ? "14d"
        : report.period === "30 D"
          ? "30d"
          : report.period === "3 M"
            ? "3m"
            : report.period === "1 Y"
              ? "1y"
              : null;
  const currentRange = periodKey
    ? {
        key: periodKey,
        period: report.period,
        activeUsers: report.activeUsers,
        sessions: report.sessions,
        pageViews: report.pageViews,
        conversions: report.conversions,
        revenue: report.revenue,
      }
    : null;
  return {
    provider: report.provider,
    period: report.period,
    ...(report.activeUsers !== undefined
      ? { activeUsers: report.activeUsers }
      : {}),
    ...(report.sessions !== undefined ? { sessions: report.sessions } : {}),
    ...(report.pageViews !== undefined ? { pageViews: report.pageViews } : {}),
    ...(report.conversions !== undefined
      ? { conversions: report.conversions }
      : {}),
    ...(report.revenue !== undefined ? { revenue: report.revenue } : {}),
    ...(report.metricLabel ? { metricLabel: report.metricLabel } : {}),
    ...(report.series?.length ? { series: report.series } : {}),
    ...(report.rangeMetrics?.length || currentRange
      ? {
          rangeMetrics: [
            ...(report.rangeMetrics ?? []),
            ...(currentRange ? [currentRange] : []),
          ],
        }
      : {}),
  };
}

function analyticsReportTask(channel: AnalyticsChannel) {
  const details = providerDetails(channel.provider);
  return `Refresh the existing ${details.product} connection for this workspace. Do not reconnect it, change credentials, or ask setup questions. Use the local credentials and tools already configured on this Mac. Pull the last 30 days of active users, sessions, page views, conversions and revenue, plus up to 14 ascending daily active-user points. Keep narration to one short line, then end with exactly one valid single-line result in this shape:
${SETUP_RESULT_MARKER} {"provider":"${channel.provider}","status":"report","period":"30 D","activeUsers":0,"sessions":0,"pageViews":0,"conversions":0,"revenue":0,"metricLabel":"Active users","series":[{"date":"YYYYMMDD","value":0}]}
Use the real numeric values. Property id: ${channel.externalId ?? "use the connected property"}.`;
}

export function AnalyticsPage() {
  const navigate = useNavigate();
  const { cloudOrganizationId } = useAuth();
  const convexAuth = useConvexAuth();
  const { status: runtimeStatus } = useRuntime();
  const [tab, setTab] = useState("overview");
  const [metricRange, setMetricRange] = useState("30d");
  const [notice, setNotice] = useState<string | null>(null);
  const [liveReports, setLiveReports] = useState<Record<string, ReportData>>(
    {},
  );
  const [refreshing, setRefreshing] = useState(false);
  const refreshingRef = useRef(false);
  const awaitingAgentRef = useRef(false);
  const autoRefreshedRef = useRef(new Set<string>());
  const handledResultsRef = useRef(new Set<string>());
  const canUseWorkspaceAnalytics =
    convexAuth.isAuthenticated && Boolean(cloudOrganizationId);

  const connectedChannels = useQuery(
    api.integrations.listConnected,
    canUseWorkspaceAnalytics ? {} : "skip",
  );
  const channelsLoading =
    canUseWorkspaceAnalytics && connectedChannels === undefined;
  const productChannels = useMemo(
    () =>
      ((connectedChannels ?? []) as AnalyticsChannel[]).filter(
        (channel) =>
          channel.category === "analytics" || channel.category === "ads",
      ),
    [connectedChannels],
  );
  const selectedChannel =
    tab === "overview"
      ? productChannels[0]
      : productChannels.find((channel) => channel.provider === tab);
  const selectedProvider = selectedChannel?.provider;
  const selectedDetails = selectedProvider
    ? providerDetails(selectedProvider)
    : null;

  useEffect(() => {
    if (tab !== "overview" && !selectedChannel) setTab("overview");
  }, [selectedChannel, tab]);

  useEffect(() => setMetricRange("30d"), [selectedProvider]);

  const storedSnapshot = useQuery(
    api.analyticsSnapshots.getLatest,
    canUseWorkspaceAnalytics && selectedProvider
      ? { provider: selectedProvider }
      : "skip",
  );
  const report = selectedProvider
    ? (liveReports[selectedProvider] ?? storedSnapshot ?? null)
    : null;

  const saveAnalyticsProperty = useMutation(api.googleAnalytics.saveProperty);
  const markIntegrationConnected = useMutation(api.integrations.markConnected);
  const saveSnapshot = useMutation(api.analyticsSnapshots.upsert);
  const getSummary = useAction(api.googleAnalytics.summary);
  const preferredIntegration = usePreferredAnalyticsIntegration();
  const workspaceProvider = getWorkspaceProvider();
  const visibleDetails =
    selectedDetails ?? providerDetails(preferredIntegration.domain);

  const reportChat = useAgentChat(
    selectedChannel ? "analyst" : null,
    workspaceProvider,
    selectedChannel
      ? `analytics-report-${selectedChannel.provider.replace(/[^a-z0-9-]/gi, "-")}`
      : undefined,
    "full",
  );

  const finishRefresh = useCallback(() => {
    refreshingRef.current = false;
    awaitingAgentRef.current = false;
    setRefreshing(false);
  }, []);

  const acceptReport = useCallback(
    (next: ReportData) => {
      const captured = { ...next, capturedAt: Date.now() };
      setLiveReports((current) => {
        const base = current[next.provider] ?? storedSnapshot ?? undefined;
        const nextRanges = snapshotArgs(captured).rangeMetrics ?? [];
        return {
          ...current,
          [next.provider]: {
            ...captured,
            series: Array.from(
              new Map(
                [...(base?.series ?? []), ...(captured.series ?? [])].map(
                  (point) => [point.date, point],
                ),
              ).values(),
            )
              .sort((a, b) => a.date.localeCompare(b.date))
              .slice(-370),
            rangeMetrics: Array.from(
              new Map(
                [...(base?.rangeMetrics ?? []), ...nextRanges].map((range) => [
                  range.key,
                  range,
                ]),
              ).values(),
            ),
          },
        };
      });
      void saveSnapshot(snapshotArgs(captured));
      setNotice(null);
      finishRefresh();
    },
    [finishRefresh, saveSnapshot, storedSnapshot],
  );

  useEffect(() => {
    let found = false;
    for (const item of reportChat.chat.items) {
      if (item.kind !== "assistant") continue;
      for (const block of item.event.content) {
        if (block.type !== "text") continue;
        const result = parseSetupResult(block.text);
        if (!result) continue;
        const next = reportFromResult(result);
        if (!next) continue;
        const key = JSON.stringify(result);
        if (handledResultsRef.current.has(key)) continue;
        handledResultsRef.current.add(key);
        acceptReport(next);
        found = true;
      }
    }
    if (
      !found &&
      awaitingAgentRef.current &&
      reportChat.chat.status === "idle"
    ) {
      setNotice("The report finished without returning analytics data.");
      finishRefresh();
    }
  }, [
    acceptReport,
    finishRefresh,
    reportChat.chat.items,
    reportChat.chat.status,
  ]);

  useEffect(() => {
    if (!reportChat.chat.error || !awaitingAgentRef.current) return;
    setNotice(reportChat.chat.error);
    finishRefresh();
  }, [finishRefresh, reportChat.chat.error]);

  const refresh = useCallback(async () => {
    if (!selectedChannel || refreshingRef.current) return;
    refreshingRef.current = true;
    setRefreshing(true);
    setNotice(null);

    if (selectedChannel.provider === GOOGLE_ANALYTICS_PROVIDER) {
      try {
        const cloudReport = (await getSummary({})) as Omit<
          ReportData,
          "provider"
        > | null;
        if (cloudReport) {
          acceptReport({
            ...cloudReport,
            provider: GOOGLE_ANALYTICS_PROVIDER,
          });
          return;
        }
      } catch {
        // Local connections intentionally have no Convex credential. Continue
        // through the local report agent instead of retrying the action.
      }
    }

    if (
      workspaceProvider &&
      runtimeStatus === "connected" &&
      reportChat.sessionReady
    ) {
      awaitingAgentRef.current = true;
      reportChat.send(analyticsReportTask(selectedChannel));
      return;
    }

    setNotice("The local analytics runner is not ready yet.");
    finishRefresh();
  }, [
    acceptReport,
    finishRefresh,
    getSummary,
    reportChat,
    runtimeStatus,
    selectedChannel,
    workspaceProvider,
  ]);

  useEffect(() => {
    if (
      !selectedChannel ||
      storedSnapshot === undefined ||
      storedSnapshot ||
      !reportChat.sessionReady ||
      autoRefreshedRef.current.has(selectedChannel._id)
    ) {
      return;
    }
    autoRefreshedRef.current.add(selectedChannel._id);
    void refresh();
  }, [refresh, reportChat.sessionReady, selectedChannel, storedSnapshot]);

  const handleSetupResult = useCallback(
    (result: SetupResult) => {
      void persistSetupResult(
        result,
        {
          saveProperty: saveAnalyticsProperty,
          markConnected: markIntegrationConnected,
          saveSnapshot,
        },
        "analytics",
      ).catch((error) => {
        setNotice(error instanceof Error ? error.message : String(error));
      });
    },
    [markIntegrationConnected, saveAnalyticsProperty, saveSnapshot],
  );

  const sourceName = selectedChannel?.displayName ?? preferredIntegration.name;
  const askAnalyst = () => {
    const draft = "What changed in our traffic recently?";
    const conversation = createChat("analyst", `${sourceName} analytics`);
    navigate(
      `/conversations?agent=analyst&chat=${conversation.id}&new=1&draft=${encodeURIComponent(draft)}`,
    );
  };

  const metricReport =
    report?.rangeMetrics?.find((range) => range.key === metricRange) ??
    (metricRange === "30d" ? report : null);
  const availableMetricRanges = METRIC_RANGES.filter(
    (range) =>
      range.key === "30d" ||
      report?.rangeMetrics?.some((stored) => stored.key === range.key),
  );

  const metrics = useMemo(() => {
    if (!metricReport) return [];
    const values = [
      metricReport.activeUsers !== undefined
        ? {
            label: "Active users",
            value: formatNumber(metricReport.activeUsers),
          }
        : null,
      metricReport.sessions !== undefined
        ? { label: "Sessions", value: formatNumber(metricReport.sessions) }
        : null,
      metricReport.pageViews !== undefined
        ? { label: "Page views", value: formatNumber(metricReport.pageViews) }
        : null,
      metricReport.conversions !== undefined
        ? {
            label: "Conversions",
            value: formatNumber(metricReport.conversions),
          }
        : null,
      metricReport.revenue !== undefined
        ? { label: "Revenue", value: formatCurrency(metricReport.revenue) }
        : null,
      metricReport.conversions !== undefined &&
      metricReport.sessions !== undefined &&
      metricReport.sessions > 0
        ? {
            label: "Conversion rate",
            value: `${((metricReport.conversions / metricReport.sessions) * 100).toFixed(1)}%`,
          }
        : null,
    ];
    return values.filter((value): value is { label: string; value: string } =>
      Boolean(value),
    );
  }, [metricReport]);

  const tabs = [
    { key: "overview", label: "Overview", domain: null },
    ...productChannels.map((channel) => {
      const details = providerDetails(channel.provider);
      return {
        key: channel.provider,
        label: details.product,
        domain: details.productDomain,
      };
    }),
  ];

  return (
    <div className="-mx-8 -mb-8 min-h-[calc(100vh-48px)]">
      <div className="border-b px-8 pb-0 pt-4">
        <h1 className="font-serif text-3xl">Analytics</h1>
        <div className="mt-5 flex items-center gap-5">
          {tabs.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setTab(item.key)}
              className={cn(
                "flex items-center gap-2 border-b border-transparent pb-3 text-sm text-muted-foreground transition-colors hover:text-foreground",
                tab === item.key && "border-foreground text-foreground",
              )}
            >
              {item.domain ? (
                <ProviderLogo
                  domain={item.domain}
                  label={item.label}
                  className="size-5 border-0"
                />
              ) : (
                <BarChart3 size={15} />
              )}
              {item.label}
            </button>
          ))}
          {channelsLoading ? (
            <span
              className="flex items-center gap-2 border-b border-transparent pb-3 text-sm opacity-0"
              aria-hidden="true"
            >
              <span className="size-5" />
              Google Analytics
            </span>
          ) : null}
        </div>
      </div>

      {!canUseWorkspaceAnalytics ? (
        <div className="px-8 pt-6">
          <div className="border bg-card p-8">
            <p className="text-sm font-medium">
              {convexAuth.isLoading
                ? "Loading workspace..."
                : "No active workspace"}
            </p>
          </div>
        </div>
      ) : channelsLoading ? (
        <AnalyticsLoadingState />
      ) : (
        <div className="space-y-5 px-8 py-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={askAnalyst}
              disabled={!selectedChannel}
            >
              <Sparkles size={14} />
              Ask Analyst
            </Button>
            <div className="flex items-center gap-3">
              {report?.capturedAt || selectedChannel?.lastSyncAt ? (
                <span className="text-xs text-muted-foreground">
                  Updated{" "}
                  {new Date(
                    report?.capturedAt ?? selectedChannel!.lastSyncAt!,
                  ).toLocaleTimeString()}
                </span>
              ) : null}
              <Button
                variant="outline"
                size="sm"
                onClick={() => void refresh()}
                disabled={!selectedChannel || refreshing}
              >
                <RefreshCw
                  size={14}
                  className={cn(refreshing && "animate-spin")}
                />
                Refresh
              </Button>
            </div>
          </div>

          <div className="border bg-card">
            <div className="flex items-center gap-3 px-5 py-3">
              <ProviderLogo
                domain={visibleDetails.familyDomain}
                label={visibleDetails.family}
                className="size-7"
              />
              <p className="text-sm font-medium">{visibleDetails.family}</p>
            </div>
            <div className="border-t p-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex min-w-0 gap-3">
                  <ProviderLogo
                    domain={visibleDetails.productDomain}
                    label={visibleDetails.product}
                    className="size-10"
                  />
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground">
                      {visibleDetails.product}
                    </p>
                    <p className="mt-1 truncate text-sm font-medium">
                      {sourceName}
                    </p>
                    {selectedChannel?.externalId ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Property {selectedChannel.externalId}
                      </p>
                    ) : null}
                  </div>
                </div>
                {selectedChannel ? (
                  <Button
                    variant="outline"
                    onClick={() =>
                      navigate(
                        `/settings/integrations/${encodeURIComponent(selectedChannel.provider)}`,
                      )
                    }
                  >
                    Manage
                  </Button>
                ) : null}
              </div>

              {!selectedChannel ? (
                <div className="mt-5 border-t pt-4">
                  {workspaceProvider ? (
                    <IntegrationConnect
                      integration={preferredIntegration}
                      driver={workspaceProvider}
                      connected={false}
                      onResult={handleSetupResult}
                    />
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Choose an agent app before connecting a source.
                    </p>
                  )}
                </div>
              ) : null}
            </div>
          </div>

          {notice ? (
            <p className="text-xs text-muted-foreground">{notice}</p>
          ) : null}

          {metrics.length > 0 ? (
            <div className="overflow-hidden border bg-card">
              <div className="flex items-center justify-between border-b px-4 py-3">
                <p className="text-xs font-medium">Performance</p>
                <div className="flex border p-0.5">
                  {availableMetricRanges.map((range) => (
                    <button
                      key={range.key}
                      type="button"
                      onClick={() => setMetricRange(range.key)}
                      className={cn(
                        "px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground",
                        metricRange === range.key &&
                          "bg-accent text-foreground",
                      )}
                    >
                      {range.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3">
                {metrics.map((metric) => (
                  <MetricCell
                    key={metric.label}
                    label={metric.label}
                    value={metric.value}
                    period={metricReport?.period ?? "30 D"}
                  />
                ))}
              </div>
            </div>
          ) : null}

          {report?.series?.length ? (
            <ConnectionPreview
              name={sourceName}
              metricLabel={report.metricLabel}
              series={report.series}
              rangeKey={metricRange}
            />
          ) : null}

          {!report && selectedChannel ? (
            <div className="flex min-h-64 items-center justify-center border bg-card px-6 py-12 text-center">
              <div className="max-w-sm">
                <h2 className="font-serif text-2xl">
                  {refreshing
                    ? "Pulling your first report..."
                    : "No report yet"}
                </h2>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">
                  {refreshing
                    ? `Reading ${sourceName} through the connection on this Mac.`
                    : "Refresh to pull current analytics from this source."}
                </p>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
