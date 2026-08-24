import { memo, useCallback, useDeferredValue, useMemo, useState } from "react";
import {
  Check,
  LoaderCircle,
  RefreshCw,
  Search,
  SlidersHorizontal,
} from "lucide-react";
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@chief/ui/components/popover";
import { cn } from "@chief/ui/lib/utils";

import type { PluginRuntimeState } from "../../lib/runtime-plugins";
import {
  comparePluginPresentation,
  featuredPluginOptions,
  PLUGIN_CATEGORY_ORDER,
  pluginCategoryLabel,
  pluginDomain,
  pluginProviderKey,
} from "../../lib/plugin-presentation";
import { ProviderLogo } from "../provider-logo";
import { PluginAction } from "./plugin-action";

type PluginView = "all" | "yours";
type TypeFilter = "all" | "connectors" | "skills";
type StatusFilter = "all" | "connected" | "attention" | "available";
type PluginGroup = [string, AgentPluginSummary[]];

function belongsToStatus(plugin: AgentPluginSummary, status: StatusFilter) {
  if (status === "all") return true;
  if (status === "connected") return plugin.status === "connected";
  if (status === "available") return plugin.status === "available";
  return [
    "authorization_required",
    "waiting",
    "failed",
    "reconnect",
    "error",
  ].includes(plugin.status);
}

function belongsToType(plugin: AgentPluginSummary, type: TypeFilter) {
  if (type === "all") return true;
  if (type === "connectors") {
    return plugin.source.type === "discovery" || plugin.source.type === "setup";
  }
  return plugin.source.type !== "discovery" && plugin.source.type !== "setup";
}

function sourceLabel(plugin: AgentPluginSummary) {
  return plugin.source.type === "discovery"
    ? "Hosted MCP"
    : plugin.source.type === "setup"
      ? "Chief setup"
      : plugin.source.type === "git"
        ? "Agent Plugin"
        : "Bundled plugin";
}

function groupPlugins(
  plugins: AgentPluginSummary[],
  includeFeatured: boolean,
): PluginGroup[] {
  const groups = new Map<string, AgentPluginSummary[]>();
  const featured = includeFeatured ? featuredPluginOptions(plugins) : [];
  const featuredProviders = new Set(featured.map(pluginProviderKey));
  if (featured.length > 0) groups.set("Featured", featured);
  for (const plugin of plugins) {
    if (featuredProviders.has(pluginProviderKey(plugin))) continue;
    const label = pluginCategoryLabel(plugin);
    groups.set(label, [...(groups.get(label) ?? []), plugin]);
  }
  return [...groups.entries()].sort(([left], [right]) => {
    const leftIndex = PLUGIN_CATEGORY_ORDER.indexOf(
      left as (typeof PLUGIN_CATEGORY_ORDER)[number],
    );
    const rightIndex = PLUGIN_CATEGORY_ORDER.indexOf(
      right as (typeof PLUGIN_CATEGORY_ORDER)[number],
    );
    if (leftIndex >= 0 || rightIndex >= 0) {
      return (
        (leftIndex >= 0 ? leftIndex : PLUGIN_CATEGORY_ORDER.length) -
        (rightIndex >= 0 ? rightIndex : PLUGIN_CATEGORY_ORDER.length)
      );
    }
    return left.localeCompare(right);
  });
}

const PluginSections = memo(function PluginSections({
  grouped,
  busyPluginId,
  onInstall,
  onAuthorize,
}: {
  grouped: PluginGroup[];
  busyPluginId: string | null;
  onInstall: (plugin: AgentPluginSummary) => void;
  onAuthorize: (plugin: AgentPluginSummary) => void;
}) {
  return grouped.map(([label, group]) => (
    <section
      key={label}
      className="[contain-intrinsic-size:auto_320px] [content-visibility:auto]"
    >
      <h2 className="text-muted-foreground mb-3 text-xs font-medium">
        {label}
      </h2>
      <div className="grid grid-cols-1 gap-x-14 gap-y-1 xl:grid-cols-2">
        {group.map((plugin) => (
          <article
            key={`${plugin.source.type}-${plugin.id}`}
            className="hover:bg-accent/30 flex min-w-0 items-center gap-4 rounded-xl px-2 py-3 transition-colors"
          >
            <ProviderLogo
              domain={pluginDomain(plugin)}
              label={plugin.name}
              className="size-12 shrink-0 rounded-[15px]"
            />
            <div className="min-w-0 flex-1 pr-5">
              <h3 className="truncate text-sm font-medium">{plugin.name}</h3>
              <p className="text-muted-foreground mt-0.5 truncate text-xs">
                {plugin.description}
              </p>
              <span className="sr-only">{sourceLabel(plugin)}</span>
            </div>
            <div className="shrink-0">
              <PluginAction
                plugin={plugin}
                busy={busyPluginId === plugin.id}
                onInstall={() => onInstall(plugin)}
                onAuthorize={() => onAuthorize(plugin)}
              />
            </div>
          </article>
        ))}
      </div>
    </section>
  ));
});

function FilterOption({
  active,
  label,
  onSelect,
}: {
  active: boolean;
  label: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="hover:bg-accent flex w-full items-center rounded-lg px-2.5 py-2 text-left text-sm transition-colors"
    >
      <span className="flex-1">{label}</span>
      {active ? <Check size={14} /> : null}
    </button>
  );
}

function PluginTrustDialog({
  plugin,
  open,
  onOpenChange,
  onConfirm,
}: {
  plugin: AgentPluginSummary | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md rounded-2xl">
        <DialogHeader>
          <DialogTitle>Add {plugin?.name ?? "plugin"}?</DialogTitle>
          <DialogDescription className="leading-5">
            This installs a pinned third-party package and enables its portable
            skills and MCP servers for agents in this workspace. Review the
            source before trusting it.
          </DialogDescription>
        </DialogHeader>
        {plugin?.repository ? (
          <p className="bg-muted text-muted-foreground truncate rounded-lg px-3 py-2 font-mono text-[11px]">
            {plugin.repository}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={onConfirm}>Add plugin</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function PluginList({ plugins }: { plugins: PluginRuntimeState }) {
  const [view, setView] = useState<PluginView>("all");
  const [query, setQuery] = useState("");
  const [type, setType] = useState<TypeFilter>("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [trustCandidate, setTrustCandidate] =
    useState<AgentPluginSummary | null>(null);
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());
  const matching = useMemo(() => {
    const matching = (plugins.plugins ?? []).filter((plugin) => {
      if (!belongsToType(plugin, type)) return false;
      if (!belongsToStatus(plugin, status)) return false;
      return (
        !deferredQuery ||
        [
          plugin.name,
          plugin.description,
          plugin.category,
          pluginCategoryLabel(plugin),
          plugin.id,
        ]
          .join(" ")
          .toLowerCase()
          .includes(deferredQuery)
      );
    });
    return [...matching].sort(comparePluginPresentation);
  }, [deferredQuery, plugins.plugins, status, type]);
  const yours = useMemo(
    () => matching.filter((plugin) => plugin.status !== "available"),
    [matching],
  );
  const allGrouped = useMemo(
    () =>
      groupPlugins(
        matching,
        type === "all" && status === "all" && !deferredQuery,
      ),
    [deferredQuery, matching, status, type],
  );
  const yoursGrouped = useMemo(() => groupPlugins(yours, false), [yours]);

  const run = useCallback(async (action: () => Promise<unknown>) => {
    try {
      await action();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  }, []);

  const install = useCallback(
    (plugin: AgentPluginSummary) => {
      if (plugin.source.type === "git") {
        setTrustCandidate(plugin);
        return;
      }
      void run(async () => {
        const installed = await plugins.install(plugin.id, true);
        if (installed?.status === "authorization_required") {
          await plugins.authorize(plugin.id);
        }
      });
    },
    [plugins, run],
  );
  const authorize = useCallback(
    (plugin: AgentPluginSummary) => {
      void run(() => plugins.authorize(plugin.id));
    },
    [plugins, run],
  );
  const visibleCount = view === "all" ? matching.length : yours.length;

  return (
    <>
      <nav
        className="flex items-center gap-5"
        aria-label="Plugin views"
        role="tablist"
      >
        {(
          [
            ["all", "All"],
            ["yours", "Yours"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={view === value}
            onClick={() => setView(value)}
            className={cn(
              "text-muted-foreground hover:text-foreground relative flex h-9 items-center text-xs font-medium transition-colors",
              view === value && "text-foreground",
            )}
          >
            {label}
            {view === value ? (
              <span className="bg-foreground absolute right-0 bottom-0 left-0 h-px" />
            ) : null}
          </button>
        ))}
      </nav>

      <div className="border-border/60 -mx-6 mt-0 border-t px-6 pt-4">
        <div className="flex flex-wrap items-center gap-3 pb-2">
          <div className="ml-auto flex min-w-0 flex-1 items-center justify-end gap-2">
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  title="Filter plugins"
                  className={cn(
                    (type !== "all" || status !== "all") && "bg-accent",
                  )}
                >
                  <SlidersHorizontal size={16} />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-60 p-2">
                <p className="text-muted-foreground px-2.5 py-1.5 text-xs">
                  Type
                </p>
                <FilterOption
                  active={type === "all"}
                  label="All types"
                  onSelect={() => setType("all")}
                />
                <FilterOption
                  active={type === "connectors"}
                  label="Connectors"
                  onSelect={() => setType("connectors")}
                />
                <FilterOption
                  active={type === "skills"}
                  label="Skills"
                  onSelect={() => setType("skills")}
                />
                <div className="border-border/70 my-2 border-t" />
                <p className="text-muted-foreground px-2.5 py-1.5 text-xs">
                  Connection
                </p>
                {(
                  [
                    ["all", "All"],
                    ["connected", "Connected"],
                    ["attention", "Needs attention"],
                    ["available", "Available"],
                  ] as const
                ).map(([value, label]) => (
                  <FilterOption
                    key={value}
                    active={status === value}
                    label={label}
                    onSelect={() => setStatus(value)}
                  />
                ))}
              </PopoverContent>
            </Popover>
            <div className="relative min-w-56 flex-1 sm:max-w-sm">
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
              title="Refresh plugins"
              onClick={() => plugins.refresh(true)}
            >
              <RefreshCw size={14} />
            </Button>
          </div>
        </div>
      </div>

      {plugins.loading ? (
        <div className="text-muted-foreground flex h-64 items-center justify-center gap-2 text-sm">
          <LoaderCircle className="animate-spin" size={16} /> Loading plugins…
        </div>
      ) : (
        <>
          <div className="space-y-8 py-5" hidden={view !== "all"}>
            <PluginSections
              grouped={allGrouped}
              busyPluginId={plugins.busyPluginId}
              onInstall={install}
              onAuthorize={authorize}
            />
          </div>
          <div className="space-y-8 py-5" hidden={view !== "yours"}>
            <PluginSections
              grouped={yoursGrouped}
              busyPluginId={plugins.busyPluginId}
              onInstall={install}
              onAuthorize={authorize}
            />
          </div>
        </>
      )}
      {!plugins.loading && visibleCount === 0 ? (
        <p className="text-muted-foreground py-20 text-center text-sm">
          {view === "yours"
            ? "You have not added any plugins yet."
            : "No plugins match those filters."}
        </p>
      ) : null}
      {plugins.warning ? (
        <p className="text-muted-foreground border-t py-3 text-xs">
          Some plugin sources could not refresh. Showing the last available
          list.
        </p>
      ) : null}
      <PluginTrustDialog
        plugin={trustCandidate}
        open={Boolean(trustCandidate)}
        onOpenChange={(open) => {
          if (!open) setTrustCandidate(null);
        }}
        onConfirm={() => {
          if (!trustCandidate) return;
          const plugin = trustCandidate;
          setTrustCandidate(null);
          void run(async () => {
            const installed = await plugins.install(plugin.id, true);
            if (installed?.status === "authorization_required") {
              await plugins.authorize(plugin.id);
            }
          });
        }}
      />
    </>
  );
}
