import { useCallback, useState } from "react";
import { toast } from "sonner";

import type {
  AgentPluginSummary,
  PluginAuthorizationAction,
} from "@chief/agent-runtime/types";

import type { PluginRuntimeState } from "../../lib/runtime-plugins";
import type { PluginApiKeyAction } from "./plugin-api-key-dialog";
import { announcePluginConnected } from "../../lib/plugin-connected";
import { pluginKeyReplacement } from "../../lib/relay-runtime-plugins";
import { useRelaySession } from "../../lib/relay-session";
import { PluginAddServerDialog } from "./plugin-add-server-dialog";
import { PluginApiKeyDialog } from "./plugin-api-key-dialog";
import { PluginDetailDialog } from "./plugin-detail-dialog";
import { PluginOAuthClientDialog } from "./plugin-oauth-client-dialog";
import { PluginTrustDialog } from "./plugin-trust-dialog";

type OAuthClientAction = Extract<
  PluginAuthorizationAction,
  { kind: "plugin_oauth_client" }
>;

type KeyReplacement = Awaited<ReturnType<typeof pluginKeyReplacement>>;

/**
 * Adding, signing in to and removing plugins, with every dialog that takes.
 * Shared by the Plugins page and anywhere else a plugin can be connected.
 * Failures are kept per plugin so a screen can show them inline; `inline`
 * skips the toast for screens that always do.
 */
export function usePluginConnectFlow(
  plugins: PluginRuntimeState,
  { inline = false }: { inline?: boolean } = {},
) {
  const { client, snapshot } = useRelaySession();
  const [trustCandidate, setTrustCandidate] =
    useState<AgentPluginSummary | null>(null);
  const [oauthClientAction, setOAuthClientAction] =
    useState<OAuthClientAction | null>(null);
  const [apiKeyAction, setApiKeyAction] = useState<PluginApiKeyAction | null>(
    null,
  );
  const [keyReplacement, setKeyReplacement] = useState<KeyReplacement | null>(
    null,
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [detailId, setDetailId] = useState<string | null>(null);
  const [addingServer, setAddingServer] = useState(false);
  const detail = detailId
    ? (plugins.plugins?.find((plugin) => plugin.id === detailId) ?? null)
    : null;

  const run = useCallback(
    async (pluginId: string, action: () => Promise<void>) => {
      setErrors(({ [pluginId]: _, ...rest }) => rest);
      try {
        await action();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setErrors((current) => ({ ...current, [pluginId]: message }));
        // The detail dialog shows its plugin's failure itself.
        if (!inline && pluginId !== detailId) toast.error(message);
      }
    },
    [detailId, inline],
  );

  const signIn = useCallback(
    async (
      pluginId: string,
      input?: Parameters<typeof plugins.authorize>[1],
    ) => {
      const action = await plugins.authorize(pluginId, input);
      if (action?.kind === "plugin_oauth_client") setOAuthClientAction(action);
      if (action?.kind === "plugin_api_key") setApiKeyAction(action);
    },
    [plugins],
  );

  const addAndSignIn = useCallback(
    async (plugin: AgentPluginSummary) => {
      const installed = await plugins.install(plugin.id, true);
      // A plugin that signs in with a key is still available until it has one.
      if (
        installed?.status === "authorization_required" ||
        installed?.status === "available"
      )
        await signIn(plugin.id);
    },
    [plugins, signIn],
  );

  const install = useCallback(
    (plugin: AgentPluginSummary) => {
      if (plugin.source.type === "git") {
        setTrustCandidate(plugin);
        return;
      }
      void run(plugin.id, () => addAndSignIn(plugin));
    },
    [addAndSignIn, run],
  );
  const authorize = useCallback(
    (plugin: AgentPluginSummary) =>
      void run(plugin.id, () => signIn(plugin.id)),
    [run, signIn],
  );
  const replaceKey = useCallback(
    (plugin: AgentPluginSummary) =>
      void run(plugin.id, async () => {
        if (!client) throw new Error("Chief is still connecting to the relay.");
        setKeyReplacement(await pluginKeyReplacement(client, plugin));
      }),
    [client, run],
  );
  const remove = useCallback(
    (plugin: AgentPluginSummary) =>
      void run(plugin.id, async () => {
        await plugins.uninstall(plugin.id);
        setDetailId((current) => (current === plugin.id ? null : current));
      }),
    [plugins, run],
  );

  const dialogs = (
    <>
      <PluginDetailDialog
        plugin={detail}
        busy={Boolean(detail && plugins.busyPluginId === detail.id)}
        error={detail ? errors[detail.id] : undefined}
        onClose={() => setDetailId(null)}
        onAdd={install}
        onConnect={authorize}
        onReplaceKey={replaceKey}
        onRemove={remove}
      />
      <PluginAddServerDialog
        open={addingServer}
        onClose={() => setAddingServer(false)}
        onAdded={(pluginId, auth) => {
          setAddingServer(false);
          setDetailId(pluginId);
          if (auth !== "oauth") {
            if (snapshot) announcePluginConnected(snapshot.id, pluginId);
            plugins.refresh(true);
            return;
          }
          void run(pluginId, () => signIn(pluginId));
        }}
      />
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
          void run(plugin.id, () => addAndSignIn(plugin));
        }}
      />
      {oauthClientAction ? (
        <PluginOAuthClientDialog
          key={`${oauthClientAction.pluginId}:${oauthClientAction.serverName}`}
          action={oauthClientAction}
          busy={plugins.busyPluginId === oauthClientAction.pluginId}
          onClose={() => setOAuthClientAction(null)}
          onSubmit={(input) => {
            const current = oauthClientAction;
            setOAuthClientAction(null);
            return run(current.pluginId, async () => {
              try {
                await signIn(current.pluginId, input);
              } catch (error) {
                setOAuthClientAction(current);
                throw error;
              }
            });
          }}
        />
      ) : null}
      {apiKeyAction ? (
        <PluginApiKeyDialog
          key={apiKeyAction.pluginId}
          action={apiKeyAction}
          onClose={() => setApiKeyAction(null)}
          onSubmit={async (input) => {
            await signIn(apiKeyAction.pluginId, input);
          }}
        />
      ) : null}
      {keyReplacement ? (
        <PluginApiKeyDialog
          key={`replace:${keyReplacement.action.pluginId}`}
          action={keyReplacement.action}
          replacing
          onClose={() => setKeyReplacement(null)}
          onSubmit={async ({ apiKey }) => {
            await keyReplacement.replace(apiKey);
            setKeyReplacement(null);
            plugins.refresh();
          }}
        />
      ) : null}
    </>
  );

  return {
    open: setDetailId,
    addServer: () => setAddingServer(true),
    install,
    authorize,
    errors,
    dialogs,
  };
}
