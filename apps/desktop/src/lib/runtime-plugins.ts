import { useCallback, useEffect, useState } from "react";
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

export interface RelayPluginActionContext {
  workspaceId: string;
  conversationId: string;
  threadRootId?: string;
  agentId: string;
  recommendationId: string;
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
        return await completed;
      } finally {
        setBusyPluginId(null);
      }
    },
    [capability, client, cloudOrganizationId, waitForPlugin],
  );

  const authorizationAction = useCallback(
    (pluginId: string) =>
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
          executorCapability: capability,
        });
      }),
    [capability, client, cloudOrganizationId],
  );

  const authorize = useCallback(
    async (pluginId: string) => {
      setBusyPluginId(pluginId);
      try {
        let lastAction: PluginAuthorizationAction | undefined;
        for (let serverIndex = 0; serverIndex < 8; serverIndex += 1) {
          const action = await authorizationAction(pluginId);
          if (!action) return lastAction;
          lastAction = action;
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

  const requestAgentAction = useCallback(
    (
      plugin: AgentPluginSummary,
      action: "install" | "authorize" | "uninstall",
      context: RelayPluginActionContext,
    ) => {
      if (
        !cloudOrganizationId ||
        !capability ||
        context.workspaceId !== cloudOrganizationId
      ) {
        throw new Error("Workspace authorization is not ready.");
      }
      const messageId = crypto.randomUUID();
      const verb = action === "uninstall" ? "disconnect" : "connect";
      client.send({
        type: "sendMessage",
        workspaceId: cloudOrganizationId,
        chatId: context.conversationId,
        messageId,
        text: `Approved: ${verb} ${plugin.name}.`,
        ...(context.threadRootId ? { threadRootId: context.threadRootId } : {}),
        mentions: [context.agentId],
        components: [
          {
            id: crypto.randomUUID(),
            kind: "plugin.action",
            version: 1,
            payload: {
              workspaceId: context.workspaceId,
              conversationId: context.conversationId,
              ...(context.threadRootId
                ? { threadRootId: context.threadRootId }
                : {}),
              targetAgentId: context.agentId,
              recommendationId: context.recommendationId,
              pluginId: plugin.id,
              pluginName: plugin.name,
              action,
            },
          },
        ],
        senderName: "You",
        executorCapability: capability,
      });
      return { messageId, verb };
    },
    [capability, client, cloudOrganizationId],
  );

  return {
    ...state,
    loading: !state,
    busyPluginId,
    refresh,
    install,
    authorize,
    uninstall,
    requestAgentAction,
  };
}

export type PluginRuntimeState = ReturnType<typeof usePlugins>;
