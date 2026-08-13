import { useCallback, useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";

import type {
  AgentPluginSummary,
  PluginAuthorizationAction,
  ServerMessage,
} from "@chief/agent-runtime/types";

import { useRuntime, useWorkspaceCapability } from "./runtime";

interface PluginState {
  plugins: AgentPluginSummary[];
  sources: { id: string; name: string; homepage?: string; enabled: boolean }[];
  refreshedAt: number;
  stale: boolean;
  warning?: string;
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
  const [busyPluginId, setBusyPluginId] = useState<string | null>(null);

  useEffect(() => {
    if (!cloudOrganizationId) return;
    const unsubscribe = client.subscribe((message) => {
      if (
        message.type !== "plugins" ||
        message.workspaceId !== cloudOrganizationId
      ) {
        return;
      }
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
    };
  }, [client, cloudOrganizationId]);

  const refresh = useCallback(
    (force = false) => {
      if (!cloudOrganizationId || !capability) return;
      client.send({
        type: "listPlugins",
        workspaceId: cloudOrganizationId,
        refresh: force,
        executorCapability: capability,
      });
    },
    [capability, client, cloudOrganizationId],
  );

  useEffect(() => {
    if (status === "connected" && capability && !state) refresh();
  }, [capability, refresh, state, status]);

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
        await completed;
      } finally {
        setBusyPluginId(null);
      }
    },
    [capability, client, cloudOrganizationId, waitForPlugin],
  );

  const authorizationAction = useCallback(
    (pluginId: string) =>
      new Promise<PluginAuthorizationAction>((resolve, reject) => {
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
          executorCapability: capability,
        });
      }),
    [capability, client, cloudOrganizationId],
  );

  const authorize = useCallback(
    async (pluginId: string) => {
      setBusyPluginId(pluginId);
      try {
        const action = await authorizationAction(pluginId);
        await openUrl(action.authorizationUrl);
        return action;
      } finally {
        setBusyPluginId(null);
      }
    },
    [authorizationAction],
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
    loading: !state,
    busyPluginId,
    refresh,
    install,
    authorize,
    uninstall,
  };
}
