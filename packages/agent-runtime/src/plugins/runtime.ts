import type { IncomingMessage, ServerResponse } from "node:http";

import type { PluginAuthorizationAction } from "@chief/plugin-api";

import type { PluginLocalToolService } from "../plugin-local-tools.js";
import type {
  ClientMessage,
  ExecutorCapability,
  McpServerSpec,
  ServerMessage,
} from "../types.js";
import type { PluginMarketplaceSnapshot } from "./types.js";
import { installCatalogPlugin, pluginMarketplace } from "./catalog.js";
import { PluginOAuthManager } from "./oauth.js";
import { removePluginInstallation, trustPluginInstallation } from "./store.js";

type PluginClientMessage = Extract<
  ClientMessage,
  {
    type:
      "listPlugins" | "installPlugin" | "authorizePlugin" | "uninstallPlugin";
  }
>;

function isPluginClientMessage(
  message: ClientMessage,
): message is PluginClientMessage {
  return [
    "listPlugins",
    "installPlugin",
    "authorizePlugin",
    "uninstallPlugin",
  ].includes(message.type);
}

/** Coordinates plugin installation, authorization, and runtime discovery. */
export class PluginRuntime {
  private readonly oauth: PluginOAuthManager;

  constructor(private readonly onChange: (workspaceId: string) => void) {
    this.oauth = new PluginOAuthManager(onChange);
  }

  async snapshot(
    workspaceId: string,
    refresh = false,
  ): Promise<PluginMarketplaceSnapshot> {
    const snapshot = await pluginMarketplace(workspaceId, refresh);
    return {
      ...snapshot,
      plugins: await Promise.all(
        snapshot.plugins.map(async (plugin) =>
          plugin.status === "authorization_required" &&
          (await this.oauth.connected(workspaceId, plugin.id))
            ? { ...plugin, status: "connected" as const }
            : plugin,
        ),
      ),
    };
  }

  mcpServers(workspaceId: string): Promise<McpServerSpec[]> {
    return this.oauth.mcpServers(workspaceId);
  }

  handleCallback(req: IncomingMessage, res: ServerResponse) {
    return this.oauth.handleCallback(req, res);
  }

  async install(workspaceId: string, pluginId: string, trusted: boolean) {
    return installCatalogPlugin(workspaceId, pluginId, trusted);
  }

  async authorize(
    workspaceId: string,
    pluginId: string,
  ): Promise<
    PluginAuthorizationAction | { pluginId: string; status: "connected" }
  > {
    const plugin = (await this.snapshot(workspaceId)).plugins.find(
      (item) => item.id === pluginId,
    );
    if (!plugin) throw new Error(`Plugin ${pluginId} was not found.`);
    await trustPluginInstallation(workspaceId, pluginId);
    const authorization = await this.oauth.start(workspaceId, pluginId);
    if (authorization.status === "connected") {
      this.onChange(workspaceId);
      return { pluginId, status: "connected" };
    }
    return {
      kind: "plugin_authorization",
      pluginId,
      pluginName: plugin.name,
      description: plugin.description,
      provider:
        plugin.source.type === "discovery" ? plugin.source.domain : plugin.name,
      authorizationUrl: authorization.authorizationUrl,
      status: "authorization_required",
    };
  }

  async uninstall(workspaceId: string, pluginId: string) {
    await this.oauth.disconnect(workspaceId, pluginId);
    await removePluginInstallation(workspaceId, pluginId);
  }

  async handleClientMessage(
    message: ClientMessage,
    authorize: (
      workspaceId: string,
      capability: ExecutorCapability,
    ) => Promise<unknown>,
    send: (message: ServerMessage) => void,
  ): Promise<boolean> {
    if (!isPluginClientMessage(message)) return false;
    await authorize(message.workspaceId, message.executorCapability);
    if (message.type === "listPlugins") {
      send({
        type: "plugins",
        workspaceId: message.workspaceId,
        ...(await this.snapshot(message.workspaceId, message.refresh)),
      });
    } else if (message.type === "installPlugin") {
      await this.install(
        message.workspaceId,
        message.pluginId,
        message.trusted,
      );
      this.onChange(message.workspaceId);
    } else if (message.type === "authorizePlugin") {
      const action = await this.authorize(
        message.workspaceId,
        message.pluginId,
      );
      if (action.status === "connected") this.onChange(message.workspaceId);
      else {
        send({
          type: "pluginAuthorization",
          workspaceId: message.workspaceId,
          requestId: message.requestId,
          action,
        });
      }
    } else {
      await this.uninstall(message.workspaceId, message.pluginId);
      this.onChange(message.workspaceId);
    }
    return true;
  }

  localTools(workspaceId: string): PluginLocalToolService {
    return {
      list: (force) => this.snapshot(workspaceId, force),
      install: async (pluginId, trusted) => {
        const { entry, loaded } = await this.install(
          workspaceId,
          pluginId,
          trusted,
        );
        this.onChange(workspaceId);
        return {
          plugin: {
            id: entry.id,
            name: entry.name,
            description: entry.description,
            installed: true,
            trusted,
            components: {
              skills: loaded.skills.map((skill) => skill.name),
              mcpServers: loaded.mcpServers.map((server) => server.name),
            },
            diagnostics: loaded.diagnostics,
          },
          instruction:
            loaded.mcpServers.length > 0
              ? "The plugin is installed. Call plugins.authorize to present the user with its provider sign-in action."
              : "The plugin is installed and its portable skills are available to future sessions.",
        };
      },
      authorize: (pluginId) => this.authorize(workspaceId, pluginId),
      uninstall: async (pluginId) => {
        await this.uninstall(workspaceId, pluginId);
        this.onChange(workspaceId);
        return {
          pluginId,
          status: "uninstalled" as const,
          instruction:
            "Chief removed the local plugin package. Provider-side access may still need to be revoked in the provider's account settings.",
        };
      },
    };
  }
}
