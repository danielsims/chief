import { useCallback, useEffect, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";

import type {
  AgentPluginSummary,
  PluginAuthorizationAction,
  ServerMessage,
} from "@chief/agent-runtime/types";

import { useRuntime, useWorkspaceCapability } from "./runtime";

export interface PluginState {
  plugins: AgentPluginSummary[];
  sources: { id: string; name: string; homepage?: string; enabled: boolean }[];
  refreshedAt: number;
  stale: boolean;
  warning?: string;
}

export interface PluginOAuthClientInput {
  serverName: string;
  clientId: string;
  clientSecret?: string;
}

const cache = new Map<string, PluginState>();

function requestId() {
  return crypto.randomUUID();
}

export function usePlugins() {
  const { client, status } = useRuntime();
  const { cloudOrganizationId, capability } = useWorkspaceCapability();
  const [received, setReceived] = useState<{
    workspaceId: string;
    value: PluginState;
  } | null>(null);
  const state = cloudOrganizationId
    ? received?.workspaceId === cloudOrganizationId
      ? received.value
      : (cache.get(cloudOrganizationId) ?? null)
    : null;
  const pending = useRef<{
    id: string;
    timer: ReturnType<typeof setTimeout>;
  } | null>(null);
  const [loadError, setLoadError] = useState<{
    workspaceId: string;
    message: string;
  } | null>(null);
  const error =
    loadError?.workspaceId === cloudOrganizationId ? loadError.message : null;
  const [refreshing, setRefreshing] = useState(false);
  const [busyPluginId, setBusyPluginId] = useState<string | null>(null);

  useEffect(() => {
    if (!cloudOrganizationId) return;
    const unsubscribe = client.subscribe((message) => {
      if (
        message.type === "error" &&
        pending.current &&
        message.requestId === pending.current.id
      ) {
        clearTimeout(pending.current.timer);
        pending.current = null;
        setRefreshing(false);
        setLoadError({
          workspaceId: cloudOrganizationId,
          message: message.message,
        });
        return;
      }
      if (
        message.type !== "plugins" ||
        message.workspaceId !== cloudOrganizationId
      ) {
        return;
      }
      if (pending.current) clearTimeout(pending.current.timer);
      pending.current = null;
      setRefreshing(false);
      setLoadError(null);
      const next: PluginState = {
        plugins: message.plugins,
        sources: message.sources,
        refreshedAt: message.refreshedAt,
        stale: message.stale,
        warning: message.warning,
      };
      cache.set(cloudOrganizationId, next);
      setReceived({ workspaceId: cloudOrganizationId, value: next });
    });
    return () => {
      unsubscribe();
      if (pending.current) clearTimeout(pending.current.timer);
      pending.current = null;
    };
  }, [client, cloudOrganizationId]);

  const refresh = useCallback(
    (force = false) => {
      if (!cloudOrganizationId || !capability || pending.current) return;
      const id = requestId();
      setLoadError(null);
      setRefreshing(true);
      pending.current = {
        id,
        timer: setTimeout(() => {
          pending.current = null;
          setRefreshing(false);
          setLoadError({
            workspaceId: cloudOrganizationId,
            message:
              "Plugins could not finish loading. Check your connection and try again.",
          });
        }, 360_000),
      };
      client.send({
        type: "listPlugins",
        requestId: id,
        workspaceId: cloudOrganizationId,
        refresh: force,
        executorCapability: capability,
      });
    },
    [capability, client, cloudOrganizationId],
  );

  useEffect(() => {
    if (status === "connected" && capability && !state && !error) refresh();
  }, [capability, error, refresh, state, status]);

  const waitForPlugin = useCallback(
    (
      pluginId: string,
      predicate: (plugin: AgentPluginSummary) => boolean,
      timeoutMs = 45_000,
    ) =>
      new Promise<AgentPluginSummary>((resolve, reject) => {
        const timer = window.setTimeout(() => {
          unsubscribe();
          reject(
            new Error("Chief did not finish the plugin operation in time."),
          );
        }, timeoutMs);
        const unsubscribe = client.subscribe((message) => {
          if (
            message.type === "error" ||
            (message.type === "plugins" &&
              message.workspaceId === cloudOrganizationId)
          ) {
            if (message.type === "error") {
              window.clearTimeout(timer);
              unsubscribe();
              reject(new Error(message.message));
              return;
            }
            const plugin = message.plugins.find((item) => item.id === pluginId);
            if (plugin && predicate(plugin)) {
              window.clearTimeout(timer);
              unsubscribe();
              resolve(plugin);
            }
          }
        });
      }),
    [client, cloudOrganizationId],
  );

  const install = useCallback(
    async (pluginId: string, trusted = true) => {
      if (!cloudOrganizationId || !capability) return;
      setBusyPluginId(pluginId);
      try {
        const completed = waitForPlugin(
          pluginId,
          (plugin) => plugin.status !== "available",
        );
        client.send({
          type: "installPlugin",
          workspaceId: cloudOrganizationId,
          pluginId,
          trusted,
          requestId: requestId(),
          executorCapability: capability,
        });
        return await completed;
      } finally {
        setBusyPluginId(null);
      }
    },
    [capability, client, cloudOrganizationId, waitForPlugin],
  );

  const authorizationAction = useCallback(
    (pluginId: string, oauthClient?: PluginOAuthClientInput) =>
      new Promise<PluginAuthorizationAction | undefined>((resolve, reject) => {
        if (!cloudOrganizationId || !capability) {
          reject(new Error("Workspace authorization is not ready."));
          return;
        }
        const id = requestId();
        const timer = window.setTimeout(() => {
          unsubscribe();
          reject(new Error("The provider sign-in request timed out."));
        }, 45_000);
        const unsubscribe = client.subscribe((message: ServerMessage) => {
          if (
            message.type === "pluginAuthorization" &&
            message.workspaceId === cloudOrganizationId &&
            message.requestId === id
          ) {
            window.clearTimeout(timer);
            unsubscribe();
            resolve(message.action);
          } else if (
            message.type === "plugins" &&
            message.workspaceId === cloudOrganizationId &&
            message.plugins.some(
              (plugin) =>
                plugin.id === pluginId && plugin.status === "connected",
            )
          ) {
            window.clearTimeout(timer);
            unsubscribe();
            resolve(undefined);
          } else if (message.type === "error" && message.requestId === id) {
            window.clearTimeout(timer);
            unsubscribe();
            reject(new Error(message.message));
          }
        });
        client.send({
          type: "authorizePlugin",
          workspaceId: cloudOrganizationId,
          pluginId,
          requestId: id,
          oauthClient,
          executorCapability: capability,
        });
      }),
    [capability, client, cloudOrganizationId],
  );

  const authorize = useCallback(
    async (pluginId: string, oauthClient?: PluginOAuthClientInput) => {
      setBusyPluginId(pluginId);
      try {
        let lastAction: PluginAuthorizationAction | undefined;
        for (let serverIndex = 0; serverIndex < 8; serverIndex += 1) {
          const action = await authorizationAction(
            pluginId,
            serverIndex === 0 ? oauthClient : undefined,
          );
          if (!action) return lastAction;
          lastAction = action;
          if (action.kind === "plugin_oauth_client") return action;
          await openUrl(action.authorizationUrl);
          const completed = waitForPlugin(
            pluginId,
            (plugin) =>
              plugin.status === "authorization_required" ||
              plugin.status === "connected" ||
              plugin.status === "failed" ||
              plugin.status === "reconnect",
            120_000,
          );
          const refreshTimer = window.setInterval(() => refresh(), 1_000);
          try {
            const plugin = await completed;
            if (plugin.status === "connected") return lastAction;
            if (plugin.status !== "authorization_required") {
              throw new Error(
                plugin.diagnostics?.at(-1) ??
                  "Chief could not finish the provider connection.",
              );
            }
          } finally {
            window.clearInterval(refreshTimer);
          }
        }
        throw new Error("This plugin publishes too many provider connections.");
      } finally {
        setBusyPluginId(null);
      }
    },
    [authorizationAction, refresh, waitForPlugin],
  );

  const uninstall = useCallback(
    async (pluginId: string) => {
      if (!cloudOrganizationId || !capability) return;
      setBusyPluginId(pluginId);
      try {
        const completed = waitForPlugin(
          pluginId,
          (plugin) => plugin.status === "available",
        );
        client.send({
          type: "uninstallPlugin",
          workspaceId: cloudOrganizationId,
          pluginId,
          requestId: requestId(),
          executorCapability: capability,
        });
        await completed;
      } finally {
        setBusyPluginId(null);
      }
    },
    [capability, client, cloudOrganizationId, waitForPlugin],
  );

  return {
    ...state,
    loading: !state && !error,
    error,
    refreshing,
    busyPluginId,
    refresh,
    install,
    authorize,
    uninstall,
  };
}

export type PluginRuntimeState = ReturnType<typeof usePlugins>;
