import type { PluginApiOperation } from "./types";

export const pluginApiPrinciples = [
  "Installing a plugin and trusting its executable capabilities are explicit, separate decisions.",
  "Authorization URLs come from MCP OAuth discovery; agents never invent provider sign-in links or receive credentials.",
  "A plugin failure is isolated to that plugin, and one invalid MCP server does not hide valid sibling servers.",
  "Uninstalling removes Chief's local registration but does not claim to revoke access at the provider.",
] as const;

export const pluginApiOperations: readonly PluginApiOperation[] = [
  {
    operationId: "plugins.list",
    method: "GET",
    path: "/local-tools/plugins",
    summary: "List plugins",
    description:
      "Lists the Chief plugin marketplace and the workspace's install, trust, and authorization state.",
    permission: "Workspace member",
    toolPermission: "integrations.manage",
    reversible: true,
  },
  {
    operationId: "plugins.install",
    method: "POST",
    path: "/local-tools/plugins/{pluginId}/install",
    summary: "Install a plugin",
    description:
      "Validates and installs a catalog plugin. Installation enables portable skills but does not silently authorize a remote service.",
    permission: "Connection management enabled",
    toolPermission: "integrations.manage",
    reversible: true,
  },
  {
    operationId: "plugins.authorize",
    method: "POST",
    path: "/local-tools/plugins/{pluginId}/authorize",
    summary: "Connect a plugin",
    description:
      "Starts standards-based MCP OAuth and returns a structured authorization action for the user. The agent never sees the resulting token.",
    permission: "Connection management enabled",
    toolPermission: "integrations.manage",
    reversible: true,
  },
  {
    operationId: "plugins.uninstall",
    method: "DELETE",
    path: "/local-tools/plugins/{pluginId}",
    summary: "Uninstall a plugin",
    description:
      "Removes the plugin from this Chief workspace. Provider-side grants may still need to be revoked separately.",
    permission: "Connection management enabled",
    toolPermission: "integrations.manage",
    reversible: false,
  },
] as const;
