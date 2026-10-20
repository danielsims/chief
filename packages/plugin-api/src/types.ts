export type PluginApiToolPermission =
  "workspace.read" | "messages.send" | "integrations.manage";

export interface PluginApiOperation {
  operationId: string;
  method: "GET" | "POST" | "DELETE";
  path: string;
  summary: string;
  description: string;
  permission: string;
  toolPermission: PluginApiToolPermission;
  reversible: boolean;
}

export interface AgentPluginCatalogEntry {
  id: string;
  name: string;
  description: string;
  category: string;
  homepage?: string;
  repository?: string;
  iconUrl?: string;
  featured?: boolean;
  popularity?: number;
  domains?: string[];
  keywords?: string[];
  source:
    | { type: "bundled"; path: string }
    | { type: "git"; url: string; sha: string; path?: string }
    | { type: "discovery"; registry: string; domain: string }
    | { type: "setup"; domain: string };
}

export type AgentPluginStatus =
  | "available"
  | "installed"
  | "authorization_required"
  | "waiting"
  | "connected"
  | "failed"
  | "reconnect"
  | "error";

export interface AgentPluginTool {
  name: string;
  title?: string;
  description: string;
  /** Only tools the server marks read-only; everything else can change data. */
  readOnly: boolean;
}

export interface AgentPluginSummary extends AgentPluginCatalogEntry {
  status: AgentPluginStatus;
  installedAt?: number;
  enabled: boolean;
  trusted: boolean;
  diagnostics?: string[];
  /** Set for a workspace connection to a remote MCP server. */
  connection?: {
    id: string;
    url: string;
    auth: "none" | "headers" | "oauth";
    tools: AgentPluginTool[];
  };
}

interface PluginAuthorizationActionBase {
  pluginId: string;
  pluginName: string;
  description: string;
  provider: string;
}

export type PluginAuthorizationAction =
  | (PluginAuthorizationActionBase & {
      kind: "plugin_authorization";
      authorizationUrl: string;
      status: "authorization_required";
    })
  | (PluginAuthorizationActionBase & {
      kind: "plugin_oauth_client";
      serverName: string;
      callbackUrl: string;
      setupUrl?: string;
      status: "client_configuration_required";
    });
