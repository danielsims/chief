import type { AgentPluginSummary } from "@chief/plugin-api";
import type { McpConnection } from "@chief/relay-contracts";

function normalized(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function searchable(plugin: AgentPluginSummary) {
  const sourceDomain =
    plugin.source.type === "discovery" || plugin.source.type === "setup"
      ? plugin.source.domain
      : "";
  return normalized(
    [
      plugin.id,
      plugin.name,
      plugin.description,
      plugin.category,
      plugin.homepage,
      sourceDomain,
      ...(plugin.domains ?? []),
      ...(plugin.keywords ?? []),
    ]
      .filter(Boolean)
      .join(" "),
  );
}

function matchScore(plugin: AgentPluginSummary, query: string) {
  const target = normalized(query);
  if (!target) return 0;
  const id = normalized(plugin.id);
  const name = normalized(plugin.name);
  const domains = [
    ...(plugin.domains ?? []),
    ...(plugin.source.type === "discovery" || plugin.source.type === "setup"
      ? [plugin.source.domain]
      : []),
  ].map(normalized);
  if (target === id || target === name || domains.includes(target)) return 100;
  if (name.includes(target) || target.includes(name)) return 80;
  const haystack = searchable(plugin);
  if (haystack.includes(target)) return 60;
  const tokens = target.split(" ").filter((token) => token.length > 1);
  return tokens.length > 0 && tokens.every((token) => haystack.includes(token))
    ? 40
    : 0;
}

export function resolvePlugins(
  plugins: AgentPluginSummary[],
  pluginIds: string[],
  services: string[],
  scope?: "connected",
) {
  if (scope === "connected")
    return {
      plugins: plugins.filter((plugin) => plugin.status === "connected"),
      missing: [],
    };
  const selected: AgentPluginSummary[] = [];
  const selectedIds = new Set<string>();
  const missing: string[] = [];
  const add = (plugin: AgentPluginSummary | undefined, requested: string) => {
    if (!plugin) {
      missing.push(requested);
      return;
    }
    if (!selectedIds.has(plugin.id)) {
      selected.push(plugin);
      selectedIds.add(plugin.id);
    }
  };
  for (const pluginId of pluginIds) {
    add(
      plugins.find((plugin) => plugin.id === pluginId),
      pluginId,
    );
  }
  for (const service of services) {
    const ranked = plugins
      .map((plugin) => ({ plugin, score: matchScore(plugin, service) }))
      .filter(({ score }) => score > 0)
      .sort((left, right) => right.score - left.score);
    // A service outside the catalog is reported missing rather than shown as a
    // card nobody can install.
    add(ranked[0]?.plugin, service);
  }
  return { plugins: selected, missing };
}

type WorkspacePlugin = AgentPluginSummary & {
  /** Set once the workspace has connected it in the relay. */
  connectionId?: string;
  toolCount?: number;
  /** Whether this agent may use it; connected alone isn't enough. */
  agentAccess?: boolean;
};

function connectionStatus(connection: McpConnection) {
  return connection.status === "connected"
    ? ("connected" as const)
    : connection.status === "needs_auth"
      ? ("authorization_required" as const)
      : ("error" as const);
}

function catalogDomain(plugin: AgentPluginSummary) {
  return plugin.source.type === "discovery" || plugin.source.type === "setup"
    ? plugin.source.domain
    : plugin.domains?.[0];
}

export function workspacePluginCatalog(
  plugins: AgentPluginSummary[],
  connections: McpConnection[],
) {
  const workspaceEntry = (connection: McpConnection) => ({
    status: connectionStatus(connection),
    enabled: true,
    trusted: true,
    connectionId: connection.id,
    toolCount: connection.tools.length,
    agentAccess: connection.assignedToYou === true,
  });
  const matched = new Set<string>();
  const catalog: WorkspacePlugin[] = plugins.map((plugin) => {
    const domain = catalogDomain(plugin)?.toLowerCase();
    const connection = connections.find(
      (item) =>
        item.catalogId === plugin.id ||
        (domain !== undefined && item.domain?.toLowerCase() === domain),
    );
    if (!connection) return { ...plugin, status: "available" };
    matched.add(connection.id);
    return { ...plugin, ...workspaceEntry(connection) };
  });
  const custom: WorkspacePlugin[] = connections
    .filter((connection) => !matched.has(connection.id))
    .map((connection) => ({
      id: connection.catalogId ?? connection.id,
      name: connection.name,
      description:
        connection.description ||
        `MCP server at ${connection.domain ?? new URL(connection.url).hostname}.`,
      category: "Other",
      source: {
        type: "setup",
        domain: connection.domain ?? new URL(connection.url).hostname,
      },
      ...workspaceEntry(connection),
    }));
  const installed = [...custom, ...catalog].filter(
    (plugin) => plugin.connectionId,
  );
  return [...installed, ...catalog.filter((plugin) => !plugin.connectionId)];
}

export function recommendationPayload(
  plugin: AgentPluginSummary,
  placement: {
    workspaceId: string;
    conversationId: string;
    threadRootId?: string;
    agentId: string;
  },
) {
  const domain =
    plugin.source.type === "discovery" || plugin.source.type === "setup"
      ? plugin.source.domain
      : plugin.domains?.[0];
  return {
    workspaceId: placement.workspaceId,
    conversationId: placement.conversationId,
    agentId: placement.agentId,
    ...(placement.threadRootId
      ? { threadRootId: placement.threadRootId }
      : undefined),
    pluginId: plugin.id,
    name: plugin.name,
    description: plugin.description,
    category: plugin.category,
    sourceType: plugin.source.type,
    status: plugin.status,
    enabled: plugin.enabled,
    trusted: plugin.trusted,
    ...(plugin.agentAccess !== undefined
      ? { agentAccess: plugin.agentAccess }
      : undefined),
    ...(plugin.homepage !== undefined
      ? { homepage: plugin.homepage }
      : undefined),
    ...(plugin.iconUrl !== undefined ? { iconUrl: plugin.iconUrl } : undefined),
    ...(domain ? { domain } : undefined),
  };
}
