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

export interface AgentPluginSummary extends AgentPluginCatalogEntry {
  status: AgentPluginStatus;
  installedAt?: number;
  enabled: boolean;
  trusted: boolean;
  diagnostics?: string[];
}

export interface PluginAuthorizationAction {
  kind: "plugin_authorization";
  pluginId: string;
  pluginName: string;
  description: string;
  provider: string;
  authorizationUrl: string;
  status: "authorization_required";
}
