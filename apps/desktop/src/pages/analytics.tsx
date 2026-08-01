/* eslint-disable max-lines */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { BarChart3, MessageSquareText, RefreshCw } from "lucide-react";
import { useNavigate } from "react-router";

import type { AnalyticsDataset } from "@chief/agent-runtime/types";
import { api } from "@chief/backend/convex/_generated/api";
import { Button } from "@chief/ui/components/button";
import { cn } from "@chief/ui/lib/utils";

import type { SetupIntegration, SetupResult } from "../lib/integration-setup";
import { LineChartCard } from "../components/charts/line-chart-card";
import { Blocks } from "../components/chat/message-blocks";
import { shortAnalyticsDate } from "../components/integrations/connection-preview";
import { IntegrationConnect } from "../components/integrations/integration-connect";
import { ProviderLogo } from "../components/provider-logo";
import { useAgentConfig } from "../lib/agent-config";
import { useAuth } from "../lib/auth/auth-context";
import {
  listAuthOrganizations,
  parseOrganizationMetadata,
} from "../lib/auth/better-auth-client";
import { createChat } from "../lib/chat-log";
import {
  persistSetupResult,
  withoutMarkerLines,
} from "../lib/integration-setup";
import { providerDetails } from "../lib/provider-details";
import {
  messageBlocks,
  useAnalyticsReportChat,
  useRuntime,
  useWorkspaceData,
} from "../lib/runtime";

interface AnalyticsChannel {
  _id: string;
  provider: string;
  category?: string;
  displayName: string;
  externalId?: string;
  lastSyncAt?: number;
}

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

function formatMetric(
  value: number,
  format: AnalyticsDataset["metrics"][number]["format"],
  currency?: string,
) {
  if (format === "percent") return `${value.toFixed(1)}%`;
  if (format === "duration") return `${formatNumber(value)} s`;
  if (format !== "currency") return formatNumber(value);
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: currency ?? "USD",
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
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className="mt-3 text-2xl font-medium tracking-normal">{value}</p>
      <p className="text-muted-foreground mt-5 text-xs">{period}</p>
    </div>
  );
}

function AnalyticsLoadingState() {
  return (
    <div className="space-y-5 px-8 py-6" aria-busy="true">
      <div className="flex h-8 items-center justify-between">
        <span className="bg-card h-8 w-28 border" />
        <span className="bg-card h-8 w-24 border" />
      </div>
      <div className="bg-card h-[154px] border" />
      <div className="bg-card h-[274px] border" />
      <div className="bg-card h-[348px] border" />
    </div>
  );
}

function AnalyticsReportProgress({
  chat,
  sourceName,
}: {
  chat: ReturnType<typeof useAnalyticsReportChat>;
  sourceName: string;
}) {
  const feedRef = useRef<HTMLDivElement>(null);
  const currentItems = useMemo(() => {
    let lastUserIndex = -1;
    for (let index = chat.messages.length - 1; index >= 0; index -= 1) {
      if (chat.messages[index]?.role === "user") {
        lastUserIndex = index;
        break;
      }
    }
    return chat.messages
      .slice(lastUserIndex + 1)
      .filter((message) => message.role === "assistant");
  }, [chat.messages]);

  useEffect(() => {
    feedRef.current?.scrollTo({
      behavior: "smooth",
      top: feedRef.current.scrollHeight,
    });
  }, [currentItems.length]);

  return (
    <div className="bg-card min-h-64 border" aria-busy="true">
      <header className="border-b px-5 py-4 text-left">
        <h2 className="chief-shimmer-text font-pixel text-xl">
          Pulling your first report
        </h2>
        <p className="text-muted-foreground mt-1.5 text-xs">
          Reading {sourceName} through this workspace’s verified connection.
        </p>
      </header>
      <div
        ref={feedRef}
        className="max-h-80 min-h-44 space-y-3 overflow-y-auto px-5 py-4"
        aria-live="polite"
      >
        {currentItems.map((item) => (
          <Blocks
            active={chat.controls.status === "running"}
            blocks={withoutMarkerLines(messageBlocks(item))}
            key={item.id}
          />
        ))}
        {currentItems.length === 0 ? (
          <p className="text-muted-foreground animate-pulse font-mono text-xs">
            Chief is checking the connection…
          </p>
        ) : null}
      </div>
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

function analyticsReportTask(channel: AnalyticsChannel) {
  const details = providerDetails(channel.provider);
  return `Refresh the existing ${details.product} connection for this workspace. Do not reconnect it, change credentials, ask setup questions, or use Chief's normalized analytics wrapper. Dynamically inspect and call the connected provider's Executor catalog directly. Pull a useful 30-day overview and previous-period comparison, including daily time-series points and any dimensions needed to explain material changes. Save the complete reusable result with analyticsSaveDataset using provider ${channel.provider}, sourceId ${channel.externalId ?? "the connected account or property id"}, key overview, period keys 30d and previous30d, exact date ranges, generic metric definitions, dimension rows, series, a chart recipe, and query provenance. The save tool is mandatory; a Markdown file or prose summary is not persistence. Then present the primary chart and summarize the evidence briefly. Property id: ${channel.externalId ?? "use the connected property"}.`;
}

export function AnalyticsPage() {
  const navigate = useNavigate();
  const { cloudOrganizationId } = useAuth();
  const convexAuth = useConvexAuth();
  const agentConfig = useAgentConfig();
  const { status: runtimeStatus } = useRuntime();
  const workspaceData = useWorkspaceData(cloudOrganizationId);
  const [tab, setTab] = useState("overview");
  const [metricRange, setMetricRange] = useState("30d");
  const [notice, setNotice] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const refreshingRef = useRef(false);
  const awaitingAgentRef = useRef(false);
  const autoRefreshedRef = useRef(new Set<string>());
  const refreshBaselineRef = useRef(0);
  const canUseWorkspaceAnalytics =
    convexAuth.isAuthenticated && Boolean(cloudOrganizationId);

  const connectedChannels = useQuery(
    api.integrations.listConnected,
    canUseWorkspaceAnalytics ? { category: "analytics" } : "skip",
  );
  const channelsLoading =
    canUseWorkspaceAnalytics && connectedChannels === undefined;
  const productChannels = useMemo(
    () => (connectedChannels ?? []) as AnalyticsChannel[],
    [connectedChannels],
  );
  const activeTab =
    tab === "overview" || productChannels.some((channel) => channel._id === tab)
      ? tab
      : "overview";
  const selectedChannel =
    activeTab === "overview"
      ? productChannels[0]
      : productChannels.find((channel) => channel._id === activeTab);
  const selectedProvider = selectedChannel?.provider;
  const selectedDetails = selectedProvider
    ? providerDetails(selectedProvider)
    : null;

  const storedDataset = workspaceData.loading
    ? undefined
    : (workspaceData.analyticsDatasets.find(
        (dataset) =>
          dataset.provider === selectedProvider &&
          dataset.key === "overview" &&
          (!selectedChannel?.externalId ||
            dataset.sourceId === selectedChannel.externalId),
      ) ?? null);
  const report = storedDataset ?? null;
  // Pending is not empty: while the persisted dataset is still resolving,
  // the page must hold geometry rather than flash "No report yet".
  const reportPending =
    Boolean(selectedProvider) && storedDataset === undefined;

  const markIntegrationConnected = useMutation(api.integrations.markConnected);
  const preferredIntegration = usePreferredAnalyticsIntegration();
  const workspaceProvider = agentConfig.forAgent("cmo").driver;
  const visibleDetails =
    selectedDetails ?? providerDetails(preferredIntegration.domain);
  const [reportChatId] = useState(() => crypto.randomUUID());
  const reportChat = useAnalyticsReportChat(
    selectedChannel ? reportChatId : null,
    agentConfig.access,
  );

  const finishRefresh = useCallback(() => {
    refreshingRef.current = false;
    awaitingAgentRef.current = false;
    setRefreshing(false);
  }, []);

  useEffect(() => {
    if (
      awaitingAgentRef.current &&
      storedDataset &&
      storedDataset.capturedAt > refreshBaselineRef.current
    ) {
      setNotice(null);
      finishRefresh();
    }
  }, [finishRefresh, storedDataset]);

  useEffect(() => {
    if (
      awaitingAgentRef.current &&
      reportChat.controls.status === "idle" &&
      !reportChat.controls.error &&
      (!storedDataset || storedDataset.capturedAt <= refreshBaselineRef.current)
    ) {
      const timer = window.setTimeout(() => {
        if (!awaitingAgentRef.current) return;
        setNotice("The report finished without saving an analytics dataset.");
        finishRefresh();
      }, 1_500);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [
    finishRefresh,
    reportChat.controls.error,
    reportChat.controls.status,
    storedDataset,
  ]);

  useEffect(() => {
    if (!reportChat.controls.error || !awaitingAgentRef.current) return;
    setNotice(reportChat.controls.error);
    finishRefresh();
  }, [finishRefresh, reportChat.controls.error]);

  const refresh = useCallback(() => {
    if (refreshingRef.current) return;
    if (!selectedChannel) return;
    refreshingRef.current = true;
    refreshBaselineRef.current = storedDataset?.capturedAt ?? 0;
    setRefreshing(true);
    setNotice(null);

    if (
      workspaceProvider &&
      runtimeStatus === "connected" &&
      reportChat.chatReady
    ) {
      awaitingAgentRef.current = true;
      void reportChat.sendMessage({
        text: analyticsReportTask(selectedChannel),
      });
      return;
    }

    setNotice("The local analytics runner is not ready yet.");
    finishRefresh();
  }, [
    finishRefresh,
    reportChat,
    runtimeStatus,
    selectedChannel,
    workspaceProvider,
    storedDataset?.capturedAt,
  ]);

  useEffect(() => {
    if (
      !selectedChannel ||
      storedDataset === undefined ||
      storedDataset ||
      !reportChat.chatReady ||
      autoRefreshedRef.current.has(selectedChannel._id)
    ) {
      return;
    }
    autoRefreshedRef.current.add(selectedChannel._id);
    void refresh();
  }, [refresh, reportChat.chatReady, selectedChannel, storedDataset]);

  const handleSetupResult = useCallback(
    (result: SetupResult) => {
      void persistSetupResult(
        result,
        {
          markConnected: markIntegrationConnected,
        },
        "analytics",
      ).catch((error) => {
        setNotice(error instanceof Error ? error.message : String(error));
      });
    },
    [markIntegrationConnected],
  );

  const sourceName = selectedChannel?.displayName ?? preferredIntegration.name;
  const askAnalyst = () => {
    const draft = "What changed in our traffic recently?";
    const conversation = createChat(`${sourceName} analytics`);
    navigate(
      `/conversations?chat=${conversation.id}&draft=${encodeURIComponent(`Consult the Analyst specialist. ${draft}`)}`,
    );
  };

  const activeMetricRange =
    report?.periods.find((period) => period.key === metricRange)?.key ??
    report?.periods[0]?.key ??
    "30d";
  const metricReport = report?.periods.find(
    (period) => period.key === activeMetricRange,
  );
  const availableMetricRanges =
    report?.periods.map((period) => ({
      key: period.key,
      label:
        (
          {
            "7d": "7D",
            "14d": "14D",
            "30d": "30D",
            "3m": "3M",
            "1y": "1Y",
          } as Record<string, string>
        )[period.key] ?? period.label,
    })) ?? [];

  const metrics = useMemo(() => {
    if (!metricReport) return [];
    const definitions = new Map(
      report?.metrics.map((metric) => [metric.key, metric]) ?? [],
    );
    return metricReport.values.flatMap((item) => {
      const metric = definitions.get(item.metric);
      return metric
        ? [
            {
              label: metric.label,
              value: formatMetric(item.value, metric.format, metric.currency),
            },
          ]
        : [];
    });
  }, [metricReport, report?.metrics]);

  const chart = report?.charts?.[0];
  const chartSeries = chart
    ? (report.series ?? []).filter((series) => chart.series.includes(series.id))
    : (report?.series ?? []).slice(0, 4);
  const updatedAt = report?.capturedAt ?? selectedChannel?.lastSyncAt;

  const tabs = [
    { key: "overview", label: "Overview", domain: null },
    ...productChannels.map((channel) => {
      const details = providerDetails(channel.provider);
      return {
        key: channel._id,
        label: details.product,
        domain: details.productDomain,
      };
    }),
  ];

  return (
    <div className="-mx-8 -mb-8 min-h-[calc(100vh-48px)]">
      <div className="border-b px-8 pt-4 pb-0">
        <h1 className="font-serif text-3xl">Analytics</h1>
        <div className="mt-5 flex items-center gap-5">
          {tabs.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setTab(item.key)}
              disabled={refreshing}
              className={cn(
                "text-muted-foreground hover:text-foreground flex items-center gap-2 border-b border-transparent pb-3 text-sm transition-colors",
                activeTab === item.key && "border-foreground text-foreground",
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
          <div className="bg-card border p-8">
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
              <MessageSquareText size={14} />
              Ask Analyst
            </Button>
            <div className="flex items-center gap-3">
              {updatedAt ? (
                <span className="text-muted-foreground text-xs">
                  Updated {new Date(updatedAt).toLocaleTimeString()}
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

          <div className="bg-card border">
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
                    <p className="text-muted-foreground text-xs">
                      {visibleDetails.product}
                    </p>
                    <p className="mt-1 truncate text-sm font-medium">
                      {sourceName}
                    </p>
                    {selectedChannel?.externalId ? (
                      <p className="text-muted-foreground mt-1 text-xs">
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
                      connected={false}
                      onResult={handleSetupResult}
                    />
                  ) : (
                    <p className="text-muted-foreground text-xs">
                      Choose an agent app before connecting a source.
                    </p>
                  )}
                </div>
              ) : null}
            </div>
          </div>

          {notice ? (
            <p className="text-muted-foreground text-xs">{notice}</p>
          ) : null}

          {metrics.length > 0 ? (
            <div className="bg-card overflow-hidden border">
              <div className="flex items-center justify-between border-b px-4 py-3">
                <p className="text-xs font-medium">Performance</p>
                <div className="flex border p-0.5">
                  {availableMetricRanges.map((range) => (
                    <button
                      key={range.key}
                      type="button"
                      onClick={() => setMetricRange(range.key)}
                      className={cn(
                        "text-muted-foreground hover:text-foreground px-2.5 py-1 text-[11px] transition-colors",
                        activeMetricRange === range.key &&
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
                    period={metricReport?.label ?? "Current period"}
                  />
                ))}
              </div>
            </div>
          ) : null}

          {chartSeries.length ? (
            <LineChartCard
              title={chart?.title ?? report?.title ?? "Performance"}
              subtitle={chart?.subtitle ?? sourceName}
              contextLabel={metricReport?.label}
              series={chartSeries}
              formatX={shortAnalyticsDate}
            />
          ) : null}

          {!report && selectedChannel ? (
            reportPending ? (
              <div
                className="bg-card min-h-64 border"
                aria-busy="true"
                aria-label="Loading report"
              />
            ) : refreshing ? (
              <AnalyticsReportProgress
                chat={reportChat}
                sourceName={sourceName}
              />
            ) : reportChat.messages.length > 0 ? (
              <AnalyticsReportProgress
                chat={reportChat}
                sourceName={sourceName}
              />
            ) : (
              <div className="bg-card flex min-h-64 items-center justify-center border px-6 py-12 text-center">
                <div className="max-w-sm">
                  <h2 className="font-pixel text-2xl">No report yet</h2>
                  <p className="text-muted-foreground mt-3 text-sm leading-6">
                    Refresh to pull current analytics from this source.
                  </p>
                </div>
              </div>
            )
          ) : null}
        </div>
      )}
    </div>
  );
}
