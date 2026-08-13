import { useMemo, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Check, LoaderCircle, RotateCw } from "lucide-react";
import { toast } from "sonner";

import type {
  AgentPluginSummary,
  ContentBlock,
} from "@chief/agent-runtime/types";
import { Button } from "@chief/ui/components/button";

import { usePlugins } from "../../lib/runtime-plugins";
import { ProviderLogo } from "../provider-logo";
import {
  pluginAuthorizationFromResult,
  pluginListFromResult,
} from "./plugin-tool-data";

type ToolUse = Extract<ContentBlock, { type: "tool_use" }>;
type ToolResult = Extract<ContentBlock, { type: "tool_result" }>;

function domain(plugin: AgentPluginSummary) {
  if (plugin.source.type === "discovery") return plugin.source.domain;
  try {
    return plugin.homepage ? new URL(plugin.homepage).hostname : plugin.id;
  } catch {
    return plugin.id;
  }
}

type PluginRuntime = ReturnType<typeof usePlugins>;
const PREVIEW_REFRESHED_AT = 1_786_555_200_000;

function PluginRow({
  plugin,
  runtime,
}: {
  plugin: AgentPluginSummary;
  runtime: PluginRuntime;
}) {
  const current =
    runtime.plugins?.find((item) => item.id === plugin.id) ?? plugin;
  const busy = runtime.busyPluginId === plugin.id;
  const connect = async () => {
    try {
      if (current.status === "available") await runtime.install(current.id);
      await runtime.authorize(current.id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };
  return (
    <div className="bg-card/60 flex min-w-0 items-center gap-3 rounded-2xl border px-3 py-3 shadow-sm">
      <ProviderLogo
        domain={domain(current)}
        label={current.name}
        className="bg-background size-10 rounded-xl border p-1.5"
      />
      <span className="min-w-0 flex-1">
        <strong className="block truncate text-sm font-medium">
          {current.name}
        </strong>
        <small className="text-muted-foreground mt-0.5 block truncate text-xs">
          {current.description}
        </small>
      </span>
      {current.status === "connected" ? (
        <span className="flex items-center gap-1 text-xs text-emerald-500">
          <Check size={13} /> Connected
        </span>
      ) : current.status === "installed" ? (
        <span className="text-muted-foreground flex items-center gap-1 text-xs">
          <Check size={13} /> Added
        </span>
      ) : (
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => void connect()}
        >
          {busy ? <LoaderCircle className="animate-spin" size={13} /> : null}
          {current.status === "available" ? "Add & authorize" : "Authorize"}
        </Button>
      )}
    </div>
  );
}

function AuthorizationCard({
  result,
  plugins,
  initiallyOpened = false,
}: {
  result: ToolResult;
  plugins: PluginRuntime;
  initiallyOpened?: boolean;
}) {
  const action = pluginAuthorizationFromResult(result);
  const [opened, setOpened] = useState(initiallyOpened);
  if (!action) return null;
  const current = plugins.plugins?.find(
    (plugin) => plugin.id === action.pluginId,
  );
  const connected = current?.status === "connected";
  const providerDomain = action.provider.includes(".")
    ? action.provider
    : action.pluginId;
  const open = async () => {
    try {
      await openUrl(action.authorizationUrl);
      setOpened(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };
  return (
    <div className="bg-card/70 w-[620px] max-w-full rounded-2xl border p-4 shadow-sm">
      <div className="flex min-w-0 items-center gap-3">
        <ProviderLogo
          domain={providerDomain}
          label={action.pluginName}
          className="bg-background size-12 rounded-xl border p-1.5"
        />
        <span className="min-w-0 flex-1">
          <strong className="block truncate text-base font-medium">
            {action.pluginName}
          </strong>
          <small className="text-muted-foreground mt-0.5 block truncate text-sm">
            {action.description}
          </small>
        </span>
        {!opened && !connected ? (
          <Button variant="outline" onClick={() => void open()}>
            Authorize
          </Button>
        ) : null}
      </div>
      {opened || connected ? (
        <div className="mt-4 flex items-center gap-2 border-t pt-3">
          {connected ? (
            <>
              <Check className="text-emerald-500" size={15} />
              <span className="text-muted-foreground text-sm">
                Connected to {action.pluginName}
              </span>
            </>
          ) : (
            <>
              <LoaderCircle
                className="text-muted-foreground animate-spin"
                size={15}
              />
              <span className="text-muted-foreground flex-1 text-sm">
                Waiting for {action.pluginName} authorization…
              </span>
              <Button variant="ghost" size="sm" onClick={() => void open()}>
                <RotateCw size={13} /> Reopen
              </Button>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

export function PluginToolCard({
  block: _block,
  result,
}: {
  block: ToolUse;
  result?: ToolResult;
}) {
  const plugins = usePlugins();
  const authorization = result
    ? pluginAuthorizationFromResult(result)
    : undefined;
  const listed = result ? pluginListFromResult(result) : undefined;
  const list = useMemo(() => listed?.slice(0, 8), [listed]);
  if (!result) {
    return (
      <div className="text-muted-foreground flex items-center gap-2 text-xs">
        <LoaderCircle className="animate-spin" size={13} /> Finding plugins…
      </div>
    );
  }
  if (authorization)
    return <AuthorizationCard result={result} plugins={plugins} />;
  if (list) {
    return (
      <div className="w-[620px] max-w-full space-y-2">
        {list.map((plugin) => (
          <PluginRow key={plugin.id} plugin={plugin} runtime={plugins} />
        ))}
      </div>
    );
  }
  return null;
}

export function PluginToolCardsPreview() {
  const plugin: AgentPluginSummary = {
    id: "posthog",
    name: "PostHog",
    description:
      "Access PostHog analytics, feature flags, experiments, error tracking, and insights directly from Chief.",
    category: "Analytics",
    homepage: "https://posthog.com",
    source: {
      type: "discovery",
      registry: "integrations.sh",
      domain: "posthog.com",
    },
    status: "authorization_required",
    enabled: true,
    trusted: true,
  };
  const runtime = {
    plugins: [plugin],
    sources: [],
    refreshedAt: PREVIEW_REFRESHED_AT,
    stale: false,
    warning: undefined,
    loading: false,
    busyPluginId: null,
    refresh: () => undefined,
    install: () => Promise.resolve(),
    authorize: () =>
      Promise.resolve({
        kind: "plugin_authorization" as const,
        pluginId: plugin.id,
        pluginName: plugin.name,
        description: plugin.description,
        provider: "posthog.com",
        authorizationUrl: "https://oauth.posthog.com/oauth/authorize/",
        status: "authorization_required" as const,
      }),
    uninstall: () => Promise.resolve(),
  } satisfies PluginRuntime;
  const result: ToolResult = {
    type: "tool_result",
    tool_use_id: "preview-posthog",
    content: JSON.stringify({
      kind: "plugin_authorization",
      pluginId: plugin.id,
      pluginName: plugin.name,
      description: plugin.description,
      provider: "posthog.com",
      authorizationUrl: "https://oauth.posthog.com/oauth/authorize/",
      status: "authorization_required",
    }),
  };
  return (
    <main className="bg-background text-foreground flex min-h-screen items-center justify-center p-10">
      <div className="w-[680px] max-w-full space-y-5">
        <AuthorizationCard result={result} plugins={runtime} />
        <AuthorizationCard result={result} plugins={runtime} initiallyOpened />
      </div>
    </main>
  );
}
