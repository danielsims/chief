import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { Check, LoaderCircle, Search } from "lucide-react";

import type { AgentPluginSummary } from "@chief/agent-runtime/types";
import { cn } from "@chief/ui/lib/utils";

import type { WorkspaceSetup } from "./use-setup";
import { AgentAppearanceProvider } from "../../components/agent-appearance-provider";
import { PluginAction } from "../../components/plugins/plugin-action";
import { usePluginConnectFlow } from "../../components/plugins/plugin-connect-flow";
import { PluginInstallAccessStep } from "../../components/plugins/plugin-install-access-step";
import { ProviderLogo } from "../../components/provider-logo";
import {
  featuredPluginOptions,
  pluginDomain,
  pluginProviderKey,
} from "../../lib/plugin-presentation";
import {
  loadRelayPluginCatalog,
  peekRelayPluginCatalog,
} from "../../lib/relay-plugin-catalog";
import { RelaySessionContext } from "../../lib/relay-session-context";
import { usePlugins } from "../../lib/runtime-plugins";
import { RuntimeCoreProvider } from "../../lib/runtime-provider";
import { SetupHeading } from "./elements";

/**
 * The app's real plugin runtime, scoped to the workspace being created, so
 * picking and connecting apps never touches the previously open workspace.
 */
export function SetupPluginScope({
  setup,
  children,
}: {
  setup: WorkspaceSetup;
  children: ReactNode;
}) {
  const scope = useMemo(
    () => ({ ...setup.relay, client: setup.client, snapshot: setup.snapshot }),
    [setup.relay, setup.client, setup.snapshot],
  );
  const client = setup.client;
  return (
    <RelaySessionContext.Provider value={scope}>
      <RuntimeCoreProvider
        loadSnapshot={client ? () => client.setupSnapshot() : undefined}
      >
        <AgentAppearanceProvider>
          {children}
          <PluginInstallAccessStep claim />
        </AgentAppearanceProvider>
      </RuntimeCoreProvider>
    </RelaySessionContext.Provider>
  );
}

/** Matches .ob-app-list's height and one row, for loading placeholders. */
const APP_LIST_HEIGHT = 326;
const ROW_HEIGHT = 66;

/** Connectors only, one per provider, like the Plugins page lists them. */
function connectors(plugins: readonly AgentPluginSummary[] | undefined) {
  const seen = new Set<string>();
  return (plugins ?? []).filter((plugin) => {
    if (plugin.source.type !== "discovery" && plugin.source.type !== "setup")
      return false;
    const key = pluginProviderKey(plugin);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function PluginRow({
  plugin,
  children,
  onClick,
  selected,
}: {
  plugin: AgentPluginSummary;
  children?: ReactNode;
  onClick?: () => void;
  selected?: boolean;
}) {
  const body = (
    <>
      <ProviderLogo
        domain={pluginDomain(plugin)}
        label={plugin.name}
        className="size-10 shrink-0 rounded-[13px]"
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">
          {plugin.name}
        </span>
        <span className="text-muted-foreground mt-0.5 block truncate text-xs">
          {plugin.description}
        </span>
      </span>
    </>
  );
  if (onClick)
    return (
      <button
        type="button"
        aria-pressed={selected}
        onClick={onClick}
        className={cn(
          "hover:bg-accent/40 focus-visible:ring-ring/40 flex w-full min-w-0 cursor-pointer items-center gap-3.5 rounded-xl px-2 py-2.5 text-left transition-colors outline-none focus-visible:ring-2",
          selected && "bg-accent/60 hover:bg-accent/60",
        )}
      >
        {body}
        <span
          className={cn(
            "grid size-5 shrink-0 place-items-center rounded-full border transition-colors",
            selected
              ? "border-foreground bg-foreground text-background"
              : "border-border",
          )}
          aria-hidden="true"
        >
          {selected ? <Check size={12} strokeWidth={3} /> : null}
        </span>
      </button>
    );
  return (
    <div className="flex min-w-0 items-center gap-3.5 px-2 py-2.5">
      {body}
      <div className="shrink-0">{children}</div>
    </div>
  );
}

/** Holds the height of what it stands in for, so the centred screen never jumps. */
function Loading({ label, height }: { label: string; height: number }) {
  return (
    <div
      className="flex items-center justify-center"
      style={{ height }}
      role="status"
      aria-label={label}
    >
      <LoaderCircle size={18} className="text-muted-foreground animate-spin" />
    </div>
  );
}

export function AppsScreen({ setup: s }: { setup: WorkspaceSetup }) {
  const plugins = usePlugins();
  const [query, setQuery] = useState("");
  // Picking only needs the catalog, so it paints from the saved copy at once
  // and the workspace's own list takes over once it loads.
  const [catalog, setCatalog] = useState(peekRelayPluginCatalog);
  useEffect(() => {
    if (catalog) return;
    let active = true;
    void loadRelayPluginCatalog(false)
      .then((loaded) => {
        if (active) setCatalog(loaded.plugins);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [catalog]);
  const source = plugins.plugins ?? catalog;
  const all = useMemo(() => connectors(source), [source]);
  const selected = new Set(s.draft.selectedApps);
  const term = query.trim().toLowerCase();
  const shown = useMemo(() => {
    if (term)
      return all.filter(
        (plugin) =>
          plugin.name.toLowerCase().includes(term) ||
          pluginDomain(plugin).includes(term),
      );
    // Featured first, then anything already picked that isn't featured.
    const featured = featuredPluginOptions(all, 24);
    const keys = new Set(featured.map(pluginDomain));
    return [
      ...featured,
      ...all.filter(
        (plugin) =>
          !keys.has(pluginDomain(plugin)) &&
          s.draft.selectedApps.includes(pluginDomain(plugin)),
      ),
    ];
  }, [all, term, s.draft.selectedApps]);
  const toggle = (domain: string) =>
    s.patch({
      selectedApps: selected.has(domain)
        ? s.draft.selectedApps.filter((value) => value !== domain)
        : [...s.draft.selectedApps, domain],
    });
  return (
    <>
      <SetupHeading title="Which apps do you use?">
        Pick the apps you work with. You’ll connect them next.
      </SetupHeading>
      <div className="ob-search">
        <Search size={16} />
        <input
          placeholder="Search apps"
          aria-label="Search apps"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      {plugins.error && !source ? (
        <p className="ob-error" role="alert">
          {plugins.error}{" "}
          <button className="ob-text" onClick={() => plugins.refresh(true)}>
            Try again
          </button>
        </p>
      ) : !source ? (
        <Loading label="Loading apps" height={APP_LIST_HEIGHT} />
      ) : (
        <div className="ob-app-list flex flex-col gap-1.5" aria-label="Apps">
          {shown.map((plugin) => (
            <PluginRow
              key={plugin.id}
              plugin={plugin}
              selected={selected.has(pluginDomain(plugin))}
              onClick={() => toggle(pluginDomain(plugin))}
            />
          ))}
          {shown.length === 0 ? (
            <p className="ob-empty">No apps match that search.</p>
          ) : null}
        </div>
      )}
      <button
        className="ob-primary"
        onClick={() => s.go(s.draft.selectedApps.length ? "plugins" : "team")}
      >
        {s.draft.selectedApps.length ? "Continue" : "Skip for now"}
        {s.draft.selectedApps.length ? (
          <span className="ob-count">{s.draft.selectedApps.length}</span>
        ) : null}
      </button>
    </>
  );
}

export function ConnectAppsScreen({ setup: s }: { setup: WorkspaceSetup }) {
  const plugins = usePlugins();
  const connect = usePluginConnectFlow(plugins, { inline: true });
  const rows = useMemo(() => {
    const picked = new Set(s.draft.selectedApps);
    return connectors(plugins.plugins).filter((plugin) =>
      picked.has(pluginDomain(plugin)),
    );
  }, [plugins.plugins, s.draft.selectedApps]);
  const connected = rows.filter((plugin) => plugin.status === "connected");
  const [saving, setSaving] = useState(false);
  // Apps picked but not signed in to are still added, so they wait under
  // Installed in Plugins with their Install button for later.
  const next = async () => {
    setSaving(true);
    try {
      await Promise.allSettled(
        rows
          .filter((plugin) => plugin.status === "available")
          .map((plugin) => plugins.install(plugin.id, true)),
      );
    } finally {
      setSaving(false);
    }
    s.go("team");
  };
  return (
    <>
      <SetupHeading title="Connect your apps">
        Sign in so Chief can work with them. You can also do this later.
      </SetupHeading>
      {plugins.error && !plugins.plugins ? (
        <p className="ob-error" role="alert">
          {plugins.error}{" "}
          <button className="ob-text" onClick={() => plugins.refresh(true)}>
            Try again
          </button>
        </p>
      ) : !plugins.plugins ? (
        <Loading
          label="Loading app connections"
          height={Math.min(
            APP_LIST_HEIGHT,
            s.draft.selectedApps.length * ROW_HEIGHT,
          )}
        />
      ) : (
        <div className="ob-app-list flex flex-col gap-1.5">
          {rows.map((plugin) => (
            <div key={plugin.id}>
              <PluginRow plugin={plugin}>
                <PluginAction
                  plugin={plugin}
                  busy={plugins.busyPluginId === plugin.id}
                  canManage
                  onInstall={() => connect.install(plugin)}
                  onAuthorize={() => connect.authorize(plugin)}
                />
              </PluginRow>
              {connect.errors[plugin.id] ? (
                <p
                  className="text-destructive -mt-1 px-2 pb-2 text-xs"
                  role="alert"
                >
                  {connect.errors[plugin.id]}
                </p>
              ) : null}
            </div>
          ))}
          {rows.length === 0 ? (
            <p className="ob-empty">
              None of these apps can be connected directly yet.
            </p>
          ) : null}
        </div>
      )}
      <button
        className="ob-primary"
        disabled={saving || Boolean(plugins.busyPluginId)}
        onClick={() => void next()}
      >
        {saving ? (
          <>
            <LoaderCircle size={15} className="animate-spin" />
            Saving your apps
          </>
        ) : connected.length === rows.length ? (
          "Continue"
        ) : (
          "Connect later"
        )}
      </button>
      {connect.dialogs}
    </>
  );
}
