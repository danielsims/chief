import { useDeferredValue, useMemo, useState } from "react";
import { Check, LoaderCircle, Plug, RefreshCw, Search } from "lucide-react";
import { toast } from "sonner";

import type { AgentPluginSummary } from "@chief/agent-runtime/types";
import { Button } from "@chief/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@chief/ui/components/dialog";
import { Input } from "@chief/ui/components/input";
import { cn } from "@chief/ui/lib/utils";

import { usePlugins } from "../lib/runtime-plugins";
import { ProviderLogo } from "./provider-logo";

function pluginDomain(plugin: AgentPluginSummary) {
  if (plugin.source.type === "discovery") return plugin.source.domain;
  try {
    return plugin.homepage ? new URL(plugin.homepage).hostname : plugin.id;
  } catch {
    return plugin.id;
  }
}

function PluginAction({
  plugin,
  busy,
  onInstall,
  onAuthorize,
}: {
  plugin: AgentPluginSummary;
  busy: boolean;
  onInstall: () => void;
  onAuthorize: () => void;
}) {
  if (busy) {
    return (
      <span className="text-muted-foreground flex items-center gap-1.5 text-xs">
        <LoaderCircle className="animate-spin" size={13} />
        Working
      </span>
    );
  }
  if (plugin.status === "connected") {
    return (
      <span className="flex items-center gap-1.5 text-xs text-emerald-500">
        <Check size={13} /> Connected
      </span>
    );
  }
  if (plugin.status === "authorization_required") {
    return (
      <Button variant="outline" size="sm" onClick={onAuthorize}>
        Authorize
      </Button>
    );
  }
  if (plugin.status === "installed") {
    return (
      <span className="text-muted-foreground flex items-center gap-1.5 text-xs">
        <Check size={13} /> Added
      </span>
    );
  }
  if (plugin.status === "error") {
    return <span className="text-destructive text-xs">Needs attention</span>;
  }
  return (
    <Button variant="outline" size="sm" onClick={onInstall}>
      Add
    </Button>
  );
}

type PluginRuntime = ReturnType<typeof usePlugins>;
const PREVIEW_REFRESHED_AT = 1_786_555_200_000;

function PluginMarketplaceContent({
  open,
  onOpenChange,
  plugins,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  plugins: PluginRuntime;
}) {
  const [tab, setTab] = useState<"marketplace" | "yours">("marketplace");
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());
  const visible = useMemo(() => {
    const candidates = (plugins.plugins ?? []).filter((plugin) =>
      tab === "yours" ? plugin.status !== "available" : true,
    );
    const matching = deferredQuery
      ? candidates.filter((plugin) =>
          [plugin.name, plugin.description, plugin.category, plugin.id]
            .join(" ")
            .toLowerCase()
            .includes(deferredQuery),
        )
      : candidates;
    return [...matching]
      .sort(
        (left, right) =>
          Number(Boolean(right.featured)) - Number(Boolean(left.featured)) ||
          left.name.localeCompare(right.name),
      )
      .slice(0, 160);
  }, [deferredQuery, plugins.plugins, tab]);

  const run = async (action: () => Promise<unknown>) => {
    try {
      await action();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-border/70 bg-popover/98 flex h-[min(780px,88vh)] max-w-5xl flex-col gap-0 overflow-hidden rounded-2xl p-0 shadow-2xl">
        <DialogHeader className="shrink-0 px-7 pt-6 pb-4 text-left">
          <DialogTitle className="flex items-center gap-2 text-xl">
            <Plug size={19} /> Plugins
          </DialogTitle>
          <DialogDescription className="sr-only">
            Browse standards-compatible plugins and connect their services.
          </DialogDescription>
        </DialogHeader>
        <div className="flex shrink-0 items-center gap-3 border-b px-7 pb-4">
          <div className="bg-muted flex rounded-lg p-0.5 text-sm">
            {(["marketplace", "yours"] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setTab(value)}
                className={cn(
                  "rounded-md px-3 py-1.5 capitalize transition-colors",
                  tab === value
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground",
                )}
              >
                {value}
              </button>
            ))}
          </div>
          <div className="relative ml-auto w-72 max-w-[42%]">
            <Search
              className="text-muted-foreground absolute top-1/2 left-2.5 -translate-y-1/2"
              size={14}
            />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search plugins"
              className="h-9 pl-8"
            />
          </div>
          <Button
            variant="ghost"
            size="icon"
            title="Refresh marketplace sources"
            onClick={() => plugins.refresh(true)}
          >
            <RefreshCw size={14} />
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-7 py-5">
          {plugins.loading ? (
            <div className="text-muted-foreground flex h-48 items-center justify-center gap-2 text-sm">
              <LoaderCircle className="animate-spin" size={16} /> Loading plugin
              catalogs…
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-x-8 gap-y-1 lg:grid-cols-2">
              {visible.map((plugin) => (
                <article
                  key={`${plugin.source.type}-${plugin.id}`}
                  className="hover:bg-accent/35 flex min-w-0 items-center gap-3 rounded-xl px-3 py-3 transition-colors"
                >
                  <ProviderLogo
                    domain={pluginDomain(plugin)}
                    label={plugin.name}
                    className="bg-background size-11 rounded-xl border p-1.5"
                  />
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-sm font-medium">
                      {plugin.name}
                    </h3>
                    <p className="text-muted-foreground mt-0.5 line-clamp-2 text-xs leading-4">
                      {plugin.description}
                    </p>
                    <p className="text-muted-foreground/60 mt-1 text-[10px] capitalize">
                      {plugin.category} ·{" "}
                      {plugin.source.type === "discovery"
                        ? "integrations.sh"
                        : "plugin marketplace"}
                    </p>
                  </div>
                  <PluginAction
                    plugin={plugin}
                    busy={plugins.busyPluginId === plugin.id}
                    onInstall={() => void run(() => plugins.install(plugin.id))}
                    onAuthorize={() =>
                      void run(() => plugins.authorize(plugin.id))
                    }
                  />
                </article>
              ))}
            </div>
          )}
          {!plugins.loading && visible.length === 0 ? (
            <p className="text-muted-foreground py-16 text-center text-sm">
              {tab === "yours"
                ? "You have not added any plugins yet."
                : "No plugins match that search."}
            </p>
          ) : null}
        </div>
        <footer className="text-muted-foreground flex shrink-0 items-center justify-between border-t px-7 py-3 text-[11px]">
          <span>
            {(plugins.plugins ?? []).length.toLocaleString()} MCP and packaged
            plugins from enabled sources
          </span>
          <span>Agent Plugins v1 · OAuth credentials stay in Keychain</span>
        </footer>
      </DialogContent>
    </Dialog>
  );
}

export function PluginMarketplaceDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const plugins = usePlugins();
  return (
    <PluginMarketplaceContent
      open={open}
      onOpenChange={onOpenChange}
      plugins={plugins}
    />
  );
}

export function PluginMarketplacePreview() {
  const previewRows: readonly [
    string,
    string,
    string,
    string,
    AgentPluginSummary["status"],
  ][] = [
    [
      "posthog",
      "PostHog",
      "Access product analytics, feature flags, experiments, error tracking, and insights.",
      "posthog.com",
      "authorization_required",
    ],
    [
      "notion",
      "Notion",
      "Search and edit pages, databases, and workspaces through Notion's hosted MCP server.",
      "notion.com",
      "connected",
    ],
    [
      "figma",
      "Figma",
      "Read design context, inspect components, and connect design-to-code workflows.",
      "figma.com",
      "available",
    ],
    [
      "slack",
      "Slack",
      "Search channels, read conversations, and send messages with workspace permissions.",
      "slack.com",
      "available",
    ],
    [
      "linear",
      "Linear",
      "Work with issues, projects, roadmaps, and team planning from Chief.",
      "linear.app",
      "available",
    ],
    [
      "vercel",
      "Vercel",
      "Manage projects, deployments, domains, and logs through the Vercel integration.",
      "vercel.com",
      "installed",
    ],
  ];
  const previewPlugins: AgentPluginSummary[] = previewRows.map(
    ([id, name, description, domain, status], index) => ({
      id,
      name,
      description,
      category: index < 2 ? "Featured" : "Productivity",
      homepage: `https://${domain}`,
      iconUrl: `https://integrations.sh/logo/${domain}`,
      featured: index < 2,
      source: {
        type: "discovery" as const,
        registry: "integrations.sh",
        domain,
      },
      status,
      enabled: status !== "available",
      trusted: status !== "available",
    }),
  );
  const preview = {
    plugins: previewPlugins,
    sources: [
      {
        id: "integrations-sh",
        name: "integrations.sh",
        homepage: "https://integrations.sh",
        enabled: true,
      },
    ],
    refreshedAt: PREVIEW_REFRESHED_AT,
    stale: false,
    warning: undefined,
    loading: false,
    busyPluginId: null,
    refresh: () => undefined,
    install: () => Promise.resolve(),
    authorize: (pluginId: string) =>
      Promise.resolve({
        kind: "plugin_authorization" as const,
        pluginId,
        pluginName: "Preview",
        description: "Preview authorization",
        provider: "example.com",
        authorizationUrl: "https://example.com/oauth",
        status: "authorization_required" as const,
      }),
    uninstall: () => Promise.resolve(),
  } satisfies PluginRuntime;
  return (
    <main className="bg-background min-h-screen">
      <PluginMarketplaceContent
        open
        onOpenChange={() => undefined}
        plugins={preview}
      />
    </main>
  );
}
