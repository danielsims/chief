import { useState } from "react";
import { Check, LoaderCircle } from "lucide-react";
import { useNavigate } from "react-router";
import { toast } from "sonner";

import type {
  AgentPluginSummary,
  ContentBlock,
  PluginAuthorizationAction,
} from "@chief/agent-runtime/types";
import { Button, buttonVariants } from "@chief/ui/components/button";
import { MatrixLoader } from "@chief/ui/components/matrix-loader";
import { cn } from "@chief/ui/lib/utils";

import type {
  PluginApiKeyInput,
  PluginOAuthClientInput,
} from "../../lib/runtime-plugins";
import type { PluginApiKeyAction } from "../plugins/plugin-api-key-dialog";
import { integrationSetupChannelPath } from "../../lib/integration-setup";
import { connectRecommendedPlugin } from "../../lib/plugin-connection";
import { pluginDomain } from "../../lib/plugin-presentation";
import { usePlugins } from "../../lib/runtime-plugins";
import { usePluginAgentAccess } from "../plugins/plugin-agent-access";
import { PluginApiKeyDialog } from "../plugins/plugin-api-key-dialog";
import { openPluginDialog } from "../plugins/plugin-dialog-host";
import { PluginOAuthClientDialog } from "../plugins/plugin-oauth-client-dialog";
import { ProviderLogo } from "../provider-logo";
import {
  INLINE_RESULT_CARD_CLASS,
  INLINE_RESULT_ICON_CLASS,
} from "./inline-result-card";
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
  agentId,
}: {
  plugin: AgentPluginSummary;
  runtime: PluginRuntime;
  authorization?: PluginAuthorizationAction;
  agentId?: string;
}) {
  const navigate = useNavigate();
  const [oauthClientAction, setOAuthClientAction] =
    useState<OAuthClientAction | null>(null);
  const [apiKeyAction, setApiKeyAction] = useState<PluginApiKeyAction | null>(
    null,
  );
  const current =
    runtime.plugins?.find((item) => item.id === plugin.id) ?? plugin;
  const access = usePluginAgentAccess(
    agentId ? (current.connection?.id ?? "") : "",
  );
  const agentAccess =
    agentId && current.connection && access.editable
      ? access.assigned(current.connection.id).has(agentId)
      : plugin.agentAccess;
  const needsAccess = current.status === "connected" && agentAccess === false;
  const open = () =>
    openPluginDialog(current.id, needsAccess ? "agents" : undefined);
  const busy = runtime.busyPluginId === plugin.id;
  const connect = async () => {
    try {
      if (authorization) {
        if (authorization.kind === "plugin_oauth_client") {
          setOAuthClientAction(authorization);
          return;
        }
        if (authorization.kind === "plugin_api_key") {
          setApiKeyAction(authorization);
          return;
        }
        // Ask the relay for a fresh sign-in instead of opening an old chat link.
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
      if (action?.kind === "plugin_api_key") setApiKeyAction(action);
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
  const submitApiKey = async (input: PluginApiKeyInput) => {
    if (!apiKeyAction) return;
    await runtime.authorize(apiKeyAction.pluginId, input);
  };
  return (
    <>
      <div
        role="button"
        tabIndex={0}
        aria-label={`Open ${current.name}`}
        onClick={open}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            open();
          }
        }}
        className="flex min-w-0 cursor-pointer items-center gap-3 rounded-2xl bg-[color-mix(in_srgb,var(--foreground)_4%,var(--background))] px-3 py-2.5 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_7%,transparent)] transition-colors hover:bg-[color-mix(in_srgb,var(--foreground)_6%,var(--background))]"
      >
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
          <span
            className={cn(
              buttonVariants({ variant: "outline", size: "xs" }),
              "pointer-events-none",
              needsAccess
                ? "text-amber-600 dark:text-amber-400"
                : "text-muted-foreground",
            )}
          >
            {needsAccess ? null : <Check size={12} />}
            {needsAccess ? "Needs access" : "Connected"}
          </span>
        ) : (
          <Button
            size="xs"
            className="relative"
            disabled={busy}
            onClick={(event) => {
              // The card opens the plugin; its button connects it.
              event.stopPropagation();
              void connect();
            }}
          >
            <span className={cn(busy && "invisible")}>
              {current.status === "reconnect" ? "Reconnect" : "Install"}
            </span>
            {busy ? (
              <LoaderCircle
                className="absolute inset-0 m-auto animate-spin"
                size={12}
              />
            ) : null}
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
      {apiKeyAction ? (
        <PluginApiKeyDialog
          key={apiKeyAction.pluginId}
          action={apiKeyAction}
          onClose={() => setApiKeyAction(null)}
          onSubmit={submitApiKey}
        />
      ) : null}
    </>
  );
}

function PluginRecommendationRows({
  plugins,
  runtime,
  authorizations,
  agentId,
}: {
  plugins: AgentPluginSummary[];
  runtime: PluginRuntime;
  authorizations?: PluginAuthorizationAction[];
  agentId?: string;
}) {
  return (
    <div className="w-full max-w-lg space-y-1.5">
      {plugins.map((plugin) => (
        <PluginRow
          key={plugin.id}
          plugin={plugin}
          runtime={runtime}
          agentId={agentId}
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
  agentId,
}: {
  plugins: AgentPluginSummary[];
  authorizations?: PluginAuthorizationAction[];
  agentId?: string;
}) {
  const runtime = usePlugins();
  return (
    <PluginRecommendationRows
      plugins={plugins}
      runtime={runtime}
      agentId={agentId}
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
  const [apiKeyAction, setApiKeyAction] = useState<PluginApiKeyAction | null>(
    action?.kind === "plugin_api_key" ? action : null,
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
      if (action.kind === "plugin_api_key") {
        setApiKeyAction(action);
        return;
      }
      const next = await plugins.authorize(action.pluginId);
      if (next?.kind === "plugin_oauth_client") setOAuthClientAction(next);
      if (next?.kind === "plugin_api_key") setApiKeyAction(next);
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
  const submitApiKey = async (input: PluginApiKeyInput) => {
    await plugins.authorize(action.pluginId, input);
  };
  return (
    <>
      <div className={INLINE_RESULT_CARD_CLASS}>
        <span className={INLINE_RESULT_ICON_CLASS}>
          <ProviderLogo
            domain={providerDomain}
            label={action.pluginName}
            className="size-6 rounded-[6px]"
          />
        </span>
        <span className="min-w-0 flex-1">
          <strong className="block truncate text-[13px] leading-5 font-medium">
            {connected
              ? `${action.pluginName} connected`
              : `${action.pluginName} isn't connected`}
          </strong>
          <small
            className={cn(
              "text-muted-foreground flex min-w-0 items-center gap-1.5 truncate text-[12px] leading-4 font-normal",
              (failed || reconnect) && "text-amber-600 dark:text-amber-500",
            )}
          >
            {waiting && !connected ? (
              <MatrixLoader size={10} ariaLabel="Waiting" />
            ) : null}
            <span className="truncate">
              {connected
                ? "Ready to use"
                : failed
                  ? "Connection didn't finish"
                  : reconnect
                    ? "Needs to reconnect"
                    : waiting
                      ? `Finish connecting in ${action.pluginName}`
                      : `Connect ${action.pluginName} to continue`}
            </span>
          </small>
        </span>
        {connected ? (
          <Check className="mr-1 shrink-0 text-emerald-500" size={15} />
        ) : (
          <Button
            size="xs"
            variant="outline"
            className="shrink-0"
            onClick={() => void (failed || reconnect ? restart() : open())}
          >
            {failed
              ? "Retry"
              : reconnect
                ? "Reconnect"
                : waiting
                  ? "Reopen"
                  : "Connect"}
          </Button>
        )}
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
      {apiKeyAction ? (
        <PluginApiKeyDialog
          key={apiKeyAction.pluginId}
          action={apiKeyAction}
          onClose={() => setApiKeyAction(null)}
          onSubmit={submitApiKey}
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
