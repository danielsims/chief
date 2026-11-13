import { useCallback, useEffect, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";

import type {
  AgentPluginSummary,
  PluginAuthorizationAction,
  ServerMessage,
} from "@chief/agent-runtime/types";

import { announcePluginConnected } from "./plugin-connected";
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

export interface PluginApiKeyInput {
  apiKey: string;
}

export type PluginAuthorizationInput =
  PluginOAuthClientInput | PluginApiKeyInput;

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
  const [refreshingWorkspace, setRefreshingWorkspace] = useState<string | null>(
    null,
  );
  const refreshing = Boolean(
    cloudOrganizationId && refreshingWorkspace === cloudOrganizationId,
  );
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
        setRefreshingWorkspace(null);
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
      setRefreshingWorkspace(null);
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
      setRefreshingWorkspace(null);
      if (pending.current) clearTimeout(pending.current.timer);
      pending.current = null;
    };
  }, [client, cloudOrganizationId]);

  const refresh = useCallback(
    (force = false) => {
      if (!cloudOrganizationId || !capability || pending.current) return;
      const id = requestId();
      setLoadError(null);
      setRefreshingWorkspace(cloudOrganizationId);
      pending.current = {
        id,
        timer: setTimeout(() => {
          pending.current = null;
          setRefreshingWorkspace(null);
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

  // A browser sign-in finishes on the relay without telling the desktop, so
  // look again when the person comes back to Chief while one is open.
  const signingIn = Boolean(
    state?.plugins.some((plugin) => plugin.status === "waiting"),
  );
  useEffect(() => {
    if (!signingIn) return;
    const recheck = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener("focus", recheck);
    document.addEventListener("visibilitychange", recheck);
    return () => {
      window.removeEventListener("focus", recheck);
      document.removeEventListener("visibilitychange", recheck);
    };
  }, [refresh, signingIn]);

  // Local tools can still be installing on first launch, so failed loads recover on their own.
  useEffect(() => {
    if (!error || state || status !== "connected") return;
    const timer = setTimeout(() => refresh(), 30_000);
    return () => clearTimeout(timer);
  }, [error, refresh, state, status]);

  const waitForPlugin = useCallback(
    (
      pluginId: string,
      predicate: (plugin: AgentPluginSummary) => boolean,
      timeoutMs = 45_000,
      requestId?: string,
    ) =>
      new Promise<AgentPluginSummary | undefined>((resolve, reject) => {
        const timer = window.setTimeout(() => {
          unsubscribe();
          reject(
            new Error("Chief did not finish the plugin operation in time."),
          );
        }, timeoutMs);
        const unsubscribe = client.subscribe((message) => {
          // A plugin that signs in with a key isn't added until it has one,
          // so asking for the key finishes the request as it stands.
          if (
            requestId &&
            message.type === "pluginAuthorization" &&
            message.requestId === requestId
          ) {
            window.clearTimeout(timer);
            unsubscribe();
            resolve(
              cloudOrganizationId
                ? cache
                    .get(cloudOrganizationId)
                    ?.plugins.find((plugin) => plugin.id === pluginId)
                : undefined,
            );
            return;
          }
          if (
            message.type === "error" ||
            (message.type === "plugins" &&
              message.workspaceId === cloudOrganizationId)
          ) {
            if (requestId && message.requestId !== requestId) return;
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
      const id = requestId();
      try {
        const completed = waitForPlugin(
          pluginId,
          (plugin) => plugin.status !== "available",
          45_000,
          id,
        );
        client.send({
          type: "installPlugin",
          workspaceId: cloudOrganizationId,
          pluginId,
          trusted,
          requestId: id,
          executorCapability: capability,
        });
        const installed = await completed;
        if (installed?.status === "connected")
          announcePluginConnected(cloudOrganizationId, pluginId);
        return installed;
      } finally {
        setBusyPluginId(null);
      }
    },
    [capability, client, cloudOrganizationId, waitForPlugin],
  );

  const authorizationAction = useCallback(
    (pluginId: string, input?: PluginAuthorizationInput) =>
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
            message.requestId === id &&
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
          ...(input && "apiKey" in input
            ? { apiKey: input.apiKey }
            : { oauthClient: input }),
          executorCapability: capability,
        });
      }),
    [capability, client, cloudOrganizationId],
  );

  const authorize = useCallback(
    async (pluginId: string, input?: PluginAuthorizationInput) => {
      setBusyPluginId(pluginId);
      try {
        let lastAction: PluginAuthorizationAction | undefined;
        for (let serverIndex = 0; serverIndex < 8; serverIndex += 1) {
          const action = await authorizationAction(
            pluginId,
            serverIndex === 0 ? input : undefined,
          );
          if (!action) {
            if (cloudOrganizationId)
              announcePluginConnected(cloudOrganizationId, pluginId);
            return lastAction;
          }
          lastAction = action;
          if (action.kind !== "plugin_authorization") return action;
          await openUrl(action.authorizationUrl);
          const completed = waitForPlugin(
            pluginId,
            (plugin) =>
              plugin.status === "authorization_required" ||
              plugin.status === "connected" ||
              plugin.status === "failed" ||
              plugin.status === "reconnect",
            600_000,
          );
          const refreshTimer = window.setInterval(() => refresh(), 2_000);
          try {
            const plugin = await completed;
            if (plugin?.status === "connected") {
              if (cloudOrganizationId)
                announcePluginConnected(cloudOrganizationId, pluginId);
              return lastAction;
            }
            if (plugin?.status !== "authorization_required") {
              throw new Error(
                plugin?.diagnostics?.at(-1) ??
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
    [authorizationAction, cloudOrganizationId, refresh, waitForPlugin],
  );

  const uninstall = useCallback(
    async (pluginId: string) => {
      if (!cloudOrganizationId || !capability) return;
      setBusyPluginId(pluginId);
      try {
        const id = requestId();
        const completed = waitForPlugin(
          pluginId,
          (plugin) => plugin.status === "available",
          45_000,
          id,
        );
        client.send({
          type: "uninstallPlugin",
          workspaceId: cloudOrganizationId,
          pluginId,
          requestId: id,
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
