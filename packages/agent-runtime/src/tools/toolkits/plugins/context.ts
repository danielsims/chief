import type {
  AgentPluginSummary,
  PluginAuthorizationAction,
} from "@chief/plugin-api";

interface InstalledPluginResult {
  plugin: {
    id: string;
    name: string;
    description?: string;
    installed: boolean;
    trusted?: boolean;
    components?: { skills: string[]; mcpServers: string[] };
    diagnostics?: string[];
  };
  instruction?: string;
  status?: "setup_required";
  reason?: string;
  fallback?: { kind: "chief_setup"; instruction: string };
}

interface UninstalledPluginResult {
  pluginId: string;
  status: "uninstalled";
  instruction: string;
}

interface PluginListSnapshot {
  plugins: AgentPluginSummary[];
  sources?: {
    id: string;
    name: string;
    catalogUrl: string;
    enabled: boolean;
  }[];
  refreshedAt?: number;
  stale?: boolean;
  warning?: string;
}

export interface PluginLocalToolService {
  list: (force?: boolean) => Promise<PluginListSnapshot>;
  install: (
    pluginId: string,
    trusted: boolean,
  ) => Promise<InstalledPluginResult>;
  authorize: (
    pluginId: string,
  ) => Promise<
    PluginAuthorizationAction | { pluginId: string; status: "connected" }
  >;
  uninstall: (pluginId: string) => Promise<UninstalledPluginResult>;
}

/** Rides on every plugins_list result, where the agent decides how to reply. */
export const PLUGINS_LIST_INSTRUCTION =
  "The person can't see this result. To show any of these plugins, connected or not, call plugins_recommend with their ids instead of naming them in text. A plugin with agentAccess false is connected but not assigned to you, so you can't use its tools yet. Install or authorize only when the person asks.";

export function searchPlugins(
  snapshot: PluginListSnapshot,
  query: string,
  limit: number,
) {
  const normalizedQuery = query.toLowerCase();
  const plugins = normalizedQuery
    ? snapshot.plugins.filter((plugin) =>
        pluginMatches(plugin, normalizedQuery),
      )
    : snapshot.plugins;
  return {
    ...snapshot,
    plugins: plugins.slice(0, limit),
    total: plugins.length,
    query: query.length > 0 ? query : undefined,
    instruction: PLUGINS_LIST_INSTRUCTION,
  };
}

function pluginMatches(plugin: AgentPluginSummary, query: string) {
  return [plugin.name, plugin.description, plugin.category, plugin.id].some(
    (value) => value.toLowerCase().includes(query),
  );
}
