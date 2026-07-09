import { useCallback, useEffect, useMemo, useState } from "react";
import { useAction, useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "@marketer/backend/convex/_generated/api";
import { Button } from "@marketer/ui/components/button";
import { cn } from "@marketer/ui/lib/utils";
import { BarChart3, LineChart, RefreshCw, Sparkles } from "lucide-react";
import { useNavigate } from "react-router";
import { useAuth } from "../lib/auth/auth-context";
import { getWorkspaceProvider } from "../lib/agent-overrides";
import {
  persistSetupResult,
  type SetupIntegration,
  type SetupResult,
} from "../lib/integration-setup";
import {
  listAuthOrganizations,
  parseOrganizationMetadata,
} from "../lib/auth/better-auth-client";
import { IntegrationConnect } from "../components/integrations/integration-connect";

type ProviderTab = "overview" | "meta" | "google-ads";

interface Summary {
  activeUsers: number;
  sessions: number;
  pageViews: number;
  conversions: number;
  revenue: number;
  period: string;
}

const tabs: Array<{ key: ProviderTab; label: string }> = [
  { key: "overview", label: "Overview" },
  { key: "meta", label: "Meta" },
  { key: "google-ads", label: "Google Ads" },
];

const GOOGLE_ANALYTICS_PROVIDER = "google-analytics";

const fallbackAnalyticsIntegration: SetupIntegration = {
  domain: "analytics.googleapis.com",
  name: "Google Analytics",
};

const bars = [58, 42, 46, 68, 34, 58, 68];
const linePoints = [30, 43, 40, 55, 51, 68, 82];

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

function polyline(points: number[]) {
  return points
    .map((value, index) => {
      const x = (index / (points.length - 1)) * 100;
      const y = 100 - value;
      return `${x},${y}`;
    })
    .join(" ");
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
      <div className="mt-5 flex items-center justify-between text-xs text-muted-foreground">
        <span>Live</span>
        <span>{period}</span>
      </div>
    </div>
  );
}

function PerformanceChart() {
  return (
    <div className="border bg-card p-5">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">Performance</p>
        <LineChart size={15} className="text-muted-foreground" />
      </div>
      <div className="mt-8 h-56">
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="h-full w-full"
        >
          <polyline
            points={polyline(linePoints.map((value) => value - 16))}
            fill="none"
            stroke="currentColor"
            strokeDasharray="2 2"
            strokeWidth="0.6"
            className="text-muted-foreground"
          />
          <polyline
            points={polyline(linePoints)}
            fill="none"
            stroke="currentColor"
            strokeWidth="1"
            className="text-foreground"
          />
        </svg>
      </div>
      <div className="mt-4 grid grid-cols-7 text-center text-xs text-muted-foreground">
        {["Jun 12", "Jun 13", "Jun 14", "Jun 15", "Jun 16", "Jun 17", "Jun 18"].map(
          (day) => (
            <span key={day}>{day}</span>
          ),
        )}
      </div>
    </div>
  );
}

function BarPanel() {
  return (
    <div className="border bg-card p-5">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">Active users</p>
        <BarChart3 size={15} className="text-muted-foreground" />
      </div>
      <div className="mt-8 flex h-56 items-end gap-3">
        {bars.map((height, index) => (
          <div
            key={index}
            className="flex min-w-0 flex-1 flex-col items-center gap-3"
          >
            <div
              className="w-full bg-foreground"
              style={{ height: `${height}%` }}
            />
            <span className="text-xs text-muted-foreground">
              {`Jun ${12 + index}`}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ComingSoonProvider({ label }: { label: string }) {
  return (
    <div className="mt-6 border bg-card p-8">
      <p className="text-sm font-medium">{label}</p>
      <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
        This provider will use the same channel model and integrations.sh
        discovery path as your analytics source.
      </p>
    </div>
  );
}

/**
 * Reads the analytics integration the user chose during onboarding so the
 * connect flow here targets their tool, not a hardcoded default.
 */
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
      const chosen =
        analytics.integration && typeof analytics.integration === "object"
          ? (analytics.integration as Record<string, unknown>)
          : null;
      if (
        chosen &&
        typeof chosen.domain === "string" &&
        chosen.domain !== "none" &&
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

export function AnalyticsPage() {
  const navigate = useNavigate();
  const { cloudOrganizationId } = useAuth();
  const convexAuth = useConvexAuth();
  const [tab, setTab] = useState<ProviderTab>("overview");
  const [notice, setNotice] = useState<string | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const canUseWorkspaceAnalytics =
    convexAuth.isAuthenticated && Boolean(cloudOrganizationId);

  const connectedChannels = useQuery(
    api.integrations.listConnected,
    canUseWorkspaceAnalytics ? { category: "analytics" } : "skip",
  );
  const saveAnalyticsProperty = useMutation(api.googleAnalytics.saveProperty);
  const markIntegrationConnected = useMutation(api.integrations.markConnected);
  const disconnectGoogleAnalytics = useMutation(api.googleAnalytics.disconnect);
  const disconnectIntegration = useMutation(api.integrations.disconnect);
  const getSummary = useAction(api.googleAnalytics.summary);

  const preferredIntegration = usePreferredAnalyticsIntegration();
  const workspaceProvider = getWorkspaceProvider();

  const channel = connectedChannels?.[0];
  const connected = Boolean(channel);
  const isGoogleAnalyticsSource =
    channel?.provider === GOOGLE_ANALYTICS_PROVIDER;
  const sourceName = channel?.displayName ?? preferredIntegration.name;
  const liveReportsAvailable = connected && isGoogleAnalyticsSource;

  const refresh = useCallback(async () => {
    if (!liveReportsAvailable || refreshing) return;
    setRefreshing(true);
    setNotice(null);
    try {
      const next = (await getSummary({})) as Summary | null;
      if (next) {
        setSummary(next);
      } else {
        setNotice(
          `${sourceName} is connected, but no property is ready for reports yet.`,
        );
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setRefreshing(false);
    }
  }, [liveReportsAvailable, getSummary, refreshing, sourceName]);

  useEffect(() => {
    if (liveReportsAvailable && !summary) void refresh();
  }, [liveReportsAvailable, refresh, summary]);

  const handleSetupResult = useCallback(
    (result: SetupResult) => {
      void persistSetupResult(
        result,
        {
          saveProperty: saveAnalyticsProperty,
          markConnected: markIntegrationConnected,
        },
        "analytics",
      ).catch((error) => {
        setNotice(error instanceof Error ? error.message : String(error));
      });
    },
    [markIntegrationConnected, saveAnalyticsProperty],
  );

  const disconnect = useCallback(() => {
    if (!channel) return;
    setSummary(null);
    void (
      isGoogleAnalyticsSource
        ? disconnectGoogleAnalytics({})
        : disconnectIntegration({ provider: channel.provider })
    ).catch((error) => {
      setNotice(error instanceof Error ? error.message : String(error));
    });
  }, [
    channel,
    disconnectGoogleAnalytics,
    disconnectIntegration,
    isGoogleAnalyticsSource,
  ]);

  const askAnalyst = () => {
    const prompt = `Review our ${sourceName} analytics. The workspace's analytics source is ${channel?.provider ?? preferredIntegration.domain}${channel?.externalId ? ` (id ${channel.externalId})` : ""}. Use the connected local tooling to pull the last 30 days of traffic and conversions, then summarize what changed and recommend one action.`;
    navigate(`/conversations?agent=analyst&prompt=${encodeURIComponent(prompt)}`);
  };

  const metrics = useMemo(() => {
    const value = (n: number, format: (n: number) => string) =>
      liveReportsAvailable && summary ? format(n) : "-";
    const s = summary ?? {
      activeUsers: 0,
      sessions: 0,
      pageViews: 0,
      conversions: 0,
      revenue: 0,
      period: "30 D",
    };
    return [
      { label: "Active users", value: value(s.activeUsers, formatNumber) },
      { label: "Sessions", value: value(s.sessions, formatNumber) },
      { label: "Page views", value: value(s.pageViews, formatNumber) },
      { label: "Conversions", value: value(s.conversions, formatNumber) },
      { label: "Revenue", value: value(s.revenue, formatCurrency) },
      {
        label: "Conversion rate",
        value:
          liveReportsAvailable && summary && s.sessions > 0
            ? `${((s.conversions / s.sessions) * 100).toFixed(1)}%`
            : "-",
      },
    ];
  }, [liveReportsAvailable, summary]);

  const period = summary?.period ?? "30 D";

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
                "border-b border-transparent pb-3 text-sm text-muted-foreground transition-colors hover:text-foreground",
                tab === item.key && "border-foreground text-foreground",
              )}
            >
              {item.label}
            </button>
          ))}
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
            <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
              Analytics needs an active workspace before it can connect a
              source or fetch reports.
            </p>
          </div>
        </div>
      ) : tab !== "overview" ? (
        <div className="px-8 pt-6">
          <ComingSoonProvider label={tab === "meta" ? "Meta" : "Google Ads"} />
        </div>
      ) : (
        <div className="space-y-5 px-8 py-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" onClick={askAnalyst}>
                <Sparkles size={14} />
                Ask Analyst
              </Button>
              <Button variant="outline" size="sm" disabled>
                Compare
              </Button>
              <Button variant="outline" size="sm" disabled>
                By channel
              </Button>
            </div>
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              {channel?.lastSyncAt ? (
                <span>
                  Last refreshed{" "}
                  {new Date(channel.lastSyncAt).toLocaleTimeString()}
                </span>
              ) : (
                <span>No report refresh yet</span>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => void refresh()}
                disabled={!liveReportsAvailable || refreshing}
              >
                <RefreshCw
                  size={14}
                  className={cn(refreshing && "animate-spin")}
                />
                Refresh
              </Button>
            </div>
          </div>

          <div className="border bg-card p-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  {connected ? sourceName : preferredIntegration.name}
                </p>
                <p className="mt-1 max-w-xl text-sm leading-6 text-muted-foreground">
                  {connected
                    ? `This workspace's analytics source${channel?.externalId ? ` (${channel.externalId})` : ""}. The Analyst agent reads it through the tools set up on this Mac.`
                    : "Your analytics source from onboarding. The setup agent connects it using this Mac and asks before changing anything."}
                </p>
              </div>
              {connected ? (
                <Button variant="outline" onClick={disconnect}>
                  Disconnect
                </Button>
              ) : null}
            </div>
            <div className="mt-5 border-t pt-4">
              {workspaceProvider ? (
                <IntegrationConnect
                  integration={
                    connected
                      ? { domain: channel?.provider ?? "", name: sourceName }
                      : preferredIntegration
                  }
                  driver={workspaceProvider}
                  connected={connected}
                  connectedLabel={sourceName}
                  onResult={handleSetupResult}
                />
              ) : (
                <p className="text-xs leading-5 text-muted-foreground">
                  Choose an agent app on the Agents page before connecting a
                  source.
                </p>
              )}
              {notice ? (
                <p className="mt-3 text-xs text-muted-foreground">{notice}</p>
              ) : null}
            </div>
          </div>

          {connected && !liveReportsAvailable ? (
            <p className="text-xs leading-5 text-muted-foreground">
              Live {sourceName} report cells are coming next. Until then, Ask
              Analyst pulls current numbers through the connected tools.
            </p>
          ) : null}

          <div className="overflow-hidden border bg-card">
            <div className="grid sm:grid-cols-2 lg:grid-cols-3">
              {metrics.map((metric) => (
                <MetricCell
                  key={metric.label}
                  label={metric.label}
                  value={metric.value}
                  period={period}
                />
              ))}
            </div>
          </div>

          <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
            <PerformanceChart />
            <BarPanel />
          </div>
        </div>
      )}
    </div>
  );
}
