import { useCallback, useState } from "react";
import { toast } from "sonner";

import type {
  AgentPluginSummary,
  PluginAuthorizationAction,
} from "@chief/agent-runtime/types";

import type { PluginRuntimeState } from "../../lib/runtime-plugins";
import { PluginAddServerDialog } from "./plugin-add-server-dialog";
import { PluginDetailDialog } from "./plugin-detail-dialog";
import { PluginOAuthClientDialog } from "./plugin-oauth-client-dialog";
import { PluginTrustDialog } from "./plugin-trust-dialog";

type OAuthClientAction = Extract<
  PluginAuthorizationAction,
  { kind: "plugin_oauth_client" }
>;

/**
 * Adding, signing in to and removing plugins, with every dialog that takes.
 * Shared by the Plugins page and anywhere else a plugin can be connected.
 */
export function usePluginConnectFlow(plugins: PluginRuntimeState) {
  const [trustCandidate, setTrustCandidate] =
    useState<AgentPluginSummary | null>(null);
  const [oauthClientAction, setOAuthClientAction] =
    useState<OAuthClientAction | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [addingServer, setAddingServer] = useState(false);
  const detail = detailId
    ? (plugins.plugins?.find((plugin) => plugin.id === detailId) ?? null)
    : null;

  const run = useCallback(async (action: () => Promise<void>) => {
    try {
      await action();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  }, []);

  const signIn = useCallback(
    async (
      pluginId: string,
      input?: Parameters<typeof plugins.authorize>[1],
    ) => {
      const action = await plugins.authorize(pluginId, input);
      if (action?.kind === "plugin_oauth_client") setOAuthClientAction(action);
    },
    [plugins],
  );

  const addAndSignIn = useCallback(
    async (plugin: AgentPluginSummary) => {
      const installed = await plugins.install(plugin.id, true);
      if (installed?.status === "authorization_required")
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
      void run(() => addAndSignIn(plugin));
    },
    [addAndSignIn, run],
  );
  const authorize = useCallback(
    (plugin: AgentPluginSummary) => void run(() => signIn(plugin.id)),
    [run, signIn],
  );
  const remove = useCallback(
    (plugin: AgentPluginSummary) => {
      setDetailId(null);
      void run(() => plugins.uninstall(plugin.id));
    },
    [plugins, run],
  );

  const dialogs = (
    <>
      <PluginDetailDialog
        plugin={detail}
        busy={Boolean(detail && plugins.busyPluginId === detail.id)}
        onClose={() => setDetailId(null)}
        onAdd={install}
        onConnect={authorize}
        onRemove={remove}
      />
      <PluginAddServerDialog
        open={addingServer}
        onClose={() => setAddingServer(false)}
        onAdded={(pluginId, auth) => {
          setAddingServer(false);
          setDetailId(pluginId);
          if (auth !== "oauth") {
            plugins.refresh(true);
            return;
          }
          void run(() => signIn(pluginId));
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
          void run(() => addAndSignIn(plugin));
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
            return run(async () => {
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
    </>
  );

  return {
    open: setDetailId,
    addServer: () => setAddingServer(true),
    install,
    authorize,
    dialogs,
  };
}
