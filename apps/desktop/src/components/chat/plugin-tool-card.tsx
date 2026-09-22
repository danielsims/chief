import { useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Check, CircleAlert, LoaderCircle, RotateCw } from "lucide-react";
import { useNavigate } from "react-router";
import { toast } from "sonner";

import type {
  AgentPluginSummary,
  ContentBlock,
  PluginAuthorizationAction,
} from "@chief/agent-runtime/types";
import { Button } from "@chief/ui/components/button";

import type { PluginOAuthClientInput } from "../../lib/runtime-plugins";
import { integrationSetupChannelPath } from "../../lib/integration-setup";
import { connectRecommendedPlugin } from "../../lib/plugin-connection";
import { pluginDomain } from "../../lib/plugin-presentation";
import { usePlugins } from "../../lib/runtime-plugins";
import { PluginOAuthClientDialog } from "../plugins/plugin-oauth-client-dialog";
import { ProviderLogo } from "../provider-logo";
import {
  pluginAuthorizationFromResult,
  pluginListFromResult,
} from "./plugin-tool-data";

type ToolUse = Extract<ContentBlock, { type: "tool_use" }>;
type ToolResult = Extract<ContentBlock, { type: "tool_result" }>;

type PluginRuntime = ReturnType<typeof usePlugins>;
type OAuthClientAction = Extract<
  PluginAuthorizationAction,
  { kind: "plugin_oauth_client" }
>;
const PREVIEW_REFRESHED_AT = 1_786_555_200_000;

function PluginRow({
  plugin,
  runtime,
  authorization,
}: {
  plugin: AgentPluginSummary;
  runtime: PluginRuntime;
  authorization?: PluginAuthorizationAction;
}) {
  const navigate = useNavigate();
  const [oauthClientAction, setOAuthClientAction] =
    useState<OAuthClientAction | null>(null);
  const current =
    runtime.plugins?.find((item) => item.id === plugin.id) ?? plugin;
  const busy = runtime.busyPluginId === plugin.id;
  const connect = async () => {
    try {
      if (authorization) {
        if (authorization.kind === "plugin_oauth_client") {
          setOAuthClientAction(authorization);
          return;
        }
        await openUrl(authorization.authorizationUrl);
        return;
      }
      if (current.source.type === "setup") {
        await navigate(
          integrationSetupChannelPath({
            domain: current.source.domain,
            name: current.name,
          }),
        );
        return;
      }
      const action = await connectRecommendedPlugin(current, runtime);
      if (action?.kind === "plugin_oauth_client") {
        setOAuthClientAction(action);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };
  const configureClient = async (input: PluginOAuthClientInput) => {
    const active = oauthClientAction;
    if (!active) return;
    setOAuthClientAction(null);
    try {
      const action = await runtime.authorize(active.pluginId, input);
      if (action?.kind === "plugin_oauth_client") setOAuthClientAction(action);
    } catch (error) {
      setOAuthClientAction(active);
      throw error;
    }
  };
  return (
    <>
      <div className="bg-card/60 flex min-w-0 items-center gap-3 rounded-2xl border px-3 py-2.5 shadow-sm">
        <ProviderLogo
          domain={pluginDomain(current)}
          label={current.name}
          className="size-10 overflow-hidden rounded-xl"
        />
        <span className="min-w-0 flex-1">
          <strong className="block truncate text-sm font-medium">
            {current.name}
          </strong>
        </span>
        {current.status === "connected" ? (
          <span className="flex items-center gap-1 text-xs text-emerald-500">
            <Check size={13} /> Connected
          </span>
        ) : (
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => void connect()}
          >
            {busy ? <LoaderCircle className="animate-spin" size={13} /> : null}
            {current.status === "available"
              ? "Authorize"
              : current.status === "waiting"
                ? "Reopen"
                : current.status === "failed" || current.status === "error"
                  ? "Retry"
                  : current.status === "reconnect"
                    ? "Reconnect"
                    : "Authorize"}
          </Button>
        )}
      </div>
      {oauthClientAction ? (
        <PluginOAuthClientDialog
          key={`${oauthClientAction.pluginId}:${oauthClientAction.serverName}`}
          action={oauthClientAction}
          busy={busy}
          onClose={() => setOAuthClientAction(null)}
          onSubmit={configureClient}
        />
      ) : null}
    </>
  );
}

function PluginRecommendationRows({
  plugins,
  runtime,
  authorizations,
}: {
  plugins: AgentPluginSummary[];
  runtime: PluginRuntime;
  authorizations?: PluginAuthorizationAction[];
}) {
  return (
    <div className="w-[620px] max-w-full space-y-2">
      {plugins.slice(0, 8).map((plugin) => (
        <PluginRow
          key={plugin.id}
          plugin={plugin}
          runtime={runtime}
          authorization={authorizations?.find(
            (authorization) => authorization.pluginId === plugin.id,
          )}
        />
      ))}
    </div>
  );
}

export function PluginRecommendationCards({
  plugins,
  authorizations,
}: {
  plugins: AgentPluginSummary[];
  authorizations?: PluginAuthorizationAction[];
}) {
  const runtime = usePlugins();
  return (
    <PluginRecommendationRows
      plugins={plugins}
      runtime={runtime}
      authorizations={authorizations}
    />
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
  const [oauthClientAction, setOAuthClientAction] =
    useState<OAuthClientAction | null>(
      action?.kind === "plugin_oauth_client" ? action : null,
    );
  if (!action) return null;
  const current = plugins.plugins?.find(
    (plugin) => plugin.id === action.pluginId,
  );
  const connected = current?.status === "connected";
  const failed = current?.status === "failed" || current?.status === "error";
  const reconnect = current?.status === "reconnect";
  const waiting =
    current?.status === "waiting" || (opened && !failed && !reconnect);
  const providerDomain = action.provider.includes(".")
    ? action.provider
    : action.pluginId;
  const open = async () => {
    try {
      if (action.kind === "plugin_oauth_client") {
        setOAuthClientAction(action);
        return;
      }
      await openUrl(action.authorizationUrl);
      setOpened(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };
  const restart = async () => {
    await open();
  };
  const configureClient = async (input: PluginOAuthClientInput) => {
    const active = oauthClientAction;
    if (!active) return;
    setOAuthClientAction(null);
    try {
      const next = await plugins.authorize(active.pluginId, input);
      if (next?.kind === "plugin_oauth_client") {
        setOAuthClientAction(next);
      } else {
        setOpened(true);
      }
    } catch (error) {
      setOAuthClientAction(active);
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };
  return (
    <>
      <div className="bg-card/70 w-[620px] max-w-full rounded-2xl border p-4 shadow-sm">
        <div className="flex min-w-0 items-center gap-3">
          <ProviderLogo
            domain={providerDomain}
            label={action.pluginName}
            className="size-12 overflow-hidden rounded-xl"
          />
          <span className="min-w-0 flex-1">
            <strong className="block truncate text-base font-medium">
              {action.pluginName}
            </strong>
            <small className="text-muted-foreground mt-0.5 block truncate text-sm">
              {action.description}
            </small>
          </span>
          {!waiting && !connected && !failed && !reconnect ? (
            <Button variant="outline" onClick={() => void open()}>
              Authorize
            </Button>
          ) : null}
        </div>
        {waiting || connected || failed || reconnect ? (
          <div className="mt-4 flex items-center gap-2 border-t pt-3">
            {connected ? (
              <>
                <Check className="text-emerald-500" size={15} />
                <span className="text-muted-foreground text-sm">
                  Connected to {action.pluginName}
                </span>
              </>
            ) : failed ? (
              <>
                <CircleAlert className="text-amber-500" size={15} />
                <span className="text-muted-foreground flex-1 text-sm">
                  {action.pluginName} authorization didn&apos;t finish.
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void restart()}
                >
                  Retry
                </Button>
              </>
            ) : reconnect ? (
              <>
                <RotateCw className="text-amber-500" size={15} />
                <span className="text-muted-foreground flex-1 text-sm">
                  {action.pluginName} needs to reconnect.
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void restart()}
                >
                  Reconnect
                </Button>
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
      {oauthClientAction ? (
        <PluginOAuthClientDialog
          key={`${oauthClientAction.pluginId}:${oauthClientAction.serverName}`}
          action={oauthClientAction}
          busy={plugins.busyPluginId === oauthClientAction.pluginId}
          onClose={() => setOAuthClientAction(null)}
          onSubmit={configureClient}
        />
      ) : null}
    </>
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
  if (!result) {
    return (
      <div className="text-muted-foreground flex items-center gap-2 text-xs">
        <LoaderCircle className="animate-spin" size={13} /> Finding plugins…
      </div>
    );
  }
  if (authorization)
    return <AuthorizationCard result={result} plugins={plugins} />;
  if (listed) return <PluginRecommendationCards plugins={listed} />;
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
    error: null,
    refreshing: false,
    busyPluginId: null,
    refresh: () => undefined,
    install: () => Promise.resolve(plugin),
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
        <PluginRecommendationRows plugins={[plugin]} runtime={runtime} />
        <AuthorizationCard result={result} plugins={runtime} />
        <AuthorizationCard result={result} plugins={runtime} initiallyOpened />
      </div>
    </main>
  );
}
