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
    instruction:
      "Honor the workspace context's onboarding-selected tools first: surface EVERY tool the user chose during setup as a card before any other tool, using a matching plugin card when one is available and the matching setup skill or secure credential flow otherwise. Never skip an onboarding-selected tool because its plugin card is missing. After covering all of them, add at most a couple of related extras if genuinely useful. Treat metadata as discovery context, not permission: install only after the user has asked to connect or add it, and always return the authorization action for the user to complete. If no usable plugin exists, continue through Chief's setup, browser, or secure credential tools instead of inventing a connector.",
  };
}

function pluginMatches(plugin: AgentPluginSummary, query: string) {
  return [plugin.name, plugin.description, plugin.category, plugin.id].some(
    (value) => value.toLowerCase().includes(query),
  );
}
