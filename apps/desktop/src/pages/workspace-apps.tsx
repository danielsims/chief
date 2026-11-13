import type { NavigateFunction } from "react-router";
import { useMemo } from "react";
import { Check, LoaderCircle } from "lucide-react";
import { Navigate, useLocation, useNavigate } from "react-router";
import { z } from "zod";

import type { AgentPluginSummary } from "@chief/agent-runtime/types";
import { Button } from "@chief/ui/components/button";

import { usePluginConnectFlow } from "../components/plugins/plugin-connect-flow";
import { ProviderLogo } from "../components/provider-logo";
import { pluginDomain } from "../lib/plugin-presentation";
import { usePlugins } from "../lib/runtime-plugins";
import { integrationDomainKey } from "./onboarding-options";

const path = "/workspaces/apps";

const workspaceAppsStateSchema = z.object({ apps: z.array(z.string()) });

/** Where a new workspace goes next: connecting the apps it picked, if any. */
export function leaveWorkspaceCreate(
  navigate: NavigateFunction,
  selectedApps: readonly string[],
) {
  void navigate(selectedApps.length ? path : "/", {
    replace: true,
    state: { apps: selectedApps },
  });
}

/**
 * Right after a workspace is created: the apps picked during setup, each
 * with its own connect action. Connecting is optional; the names already
 * went to Setup with the workspace.
 */
export function WorkspaceAppsPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const plugins = usePlugins();
  const connect = usePluginConnectFlow(plugins, { inline: true });
  const apps = useMemo(
    () => workspaceAppsStateSchema.safeParse(location.state).data?.apps ?? [],
    [location.state],
  );
  const rows = useMemo(() => {
    const picked = new Set(apps.map(integrationDomainKey));
    return (plugins.plugins ?? []).filter(
      (plugin) =>
        plugin.source.type === "discovery" &&
        picked.has(integrationDomainKey(pluginDomain(plugin))),
    );
  }, [apps, plugins.plugins]);
  const done = () => void navigate("/", { replace: true });
  const nothingToConnect =
    apps.length === 0 ||
    (!plugins.loading && !plugins.error && rows.length === 0);

  if (nothingToConnect) return <Navigate to="/" replace />;
  const anyConnected = rows.some((plugin) => plugin.status === "connected");

  return (
    <div className="bg-background text-foreground flex h-screen flex-col">
      <header data-tauri-drag-region className="h-[72px] shrink-0" />
      <main className="flex min-h-0 flex-1 overflow-y-auto px-6 pb-10">
        <div className="mx-auto flex min-h-full w-full max-w-[560px] flex-col justify-center gap-6 py-12">
          <div>
            <h1 className="text-[28px] leading-tight font-normal tracking-[-0.035em]">
              Connect your apps
            </h1>
            <p className="text-muted-foreground mt-2 text-sm leading-6">
              You can also do this later in Plugins.
            </p>
          </div>
          {plugins.error ? (
            <p className="text-destructive text-xs leading-5">
              {plugins.error}
            </p>
          ) : plugins.loading ? (
            <LoaderCircle
              className="text-muted-foreground animate-spin"
              size={16}
            />
          ) : (
            <ul className="divide-border/60 divide-y rounded-xl border">
              {rows.map((plugin) => (
                <AppRow
                  key={plugin.id}
                  plugin={plugin}
                  busy={plugins.busyPluginId === plugin.id}
                  error={connect.errors[plugin.id]}
                  onConnect={() =>
                    plugin.status === "available"
                      ? connect.install(plugin)
                      : connect.authorize(plugin)
                  }
                />
              ))}
            </ul>
          )}
          <div className="flex justify-end gap-2">
            {anyConnected ? (
              <Button onClick={done}>Continue</Button>
            ) : (
              <Button variant="ghost" onClick={done}>
                Skip
              </Button>
            )}
          </div>
        </div>
      </main>
      {connect.dialogs}
    </div>
  );
}

function AppRow({
  plugin,
  busy,
  error,
  onConnect,
}: {
  plugin: AgentPluginSummary;
  busy: boolean;
  error?: string;
  onConnect: () => void;
}) {
  const connecting = busy || plugin.status === "waiting";
  const failure =
    error ??
    (plugin.status === "failed" || plugin.status === "error"
      ? (plugin.diagnostics?.at(-1) ?? "Couldn't connect.")
      : undefined);
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <ProviderLogo
        domain={pluginDomain(plugin)}
        label={plugin.name}
        className="size-8 shrink-0 overflow-hidden rounded-lg"
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">
          {plugin.name}
        </span>
        {failure ? (
          <span className="text-destructive block text-xs leading-5">
            {failure}
          </span>
        ) : null}
      </span>
      {plugin.status === "connected" ? (
        <span className="flex items-center gap-1.5 text-xs text-emerald-500">
          <Check size={13} /> Connected
        </span>
      ) : connecting ? (
        <span className="text-muted-foreground flex items-center gap-1.5 text-xs">
          <LoaderCircle className="animate-spin" size={13} /> Connecting…
        </span>
      ) : (
        <Button variant="outline" size="sm" onClick={onConnect}>
          {failure ? "Try again" : "Connect"}
        </Button>
      )}
    </li>
  );
}
