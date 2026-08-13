import type {
  AgentPluginCatalogEntry,
  AgentPluginSummary,
} from "@chief/plugin-api";

export interface PortablePluginManifest {
  $schema: string;
  name: string;
  version?: string;
  description?: string;
  author?: { name: string; url?: string };
  homepage?: string;
  repository?: string;
  license?: string;
  keywords?: string[];
}

export type PortableMcpServer =
  | {
      type: "stdio";
      command: string;
      args?: string[];
      env?: Record<string, string>;
      cwd?: string;
    }
  | {
      type: "streamable-http" | "sse";
      url: string;
      headers?: Record<string, string>;
    };

export interface LoadedAgentPlugin {
  root: string;
  manifest: PortablePluginManifest;
  skills: { name: string; path: string }[];
  mcpServers: { name: string; spec: PortableMcpServer }[];
  diagnostics: string[];
}

export interface PluginInstallRecord {
  id: string;
  packageRoot: string;
  sourceSha?: string;
  enabled: boolean;
  trusted: boolean;
  installedAt: number;
}

export interface PluginWorkspaceState {
  version: 1;
  marketplaceSources: PluginMarketplaceSource[];
  installations: Record<string, PluginInstallRecord>;
}

export interface PluginMarketplaceSource {
  id: string;
  name: string;
  catalogUrl: string;
  homepage?: string;
  enabled: boolean;
  format?: "marketplace" | "integrations-sh";
}

export interface RemotePluginCatalogEntry extends Omit<
  AgentPluginCatalogEntry,
  "source"
> {
  source:
    | {
        type: "git";
        url: string;
        sha: string;
        path?: string;
      }
    | { type: "bundled"; path: string }
    | { type: "discovery"; registry: string; domain: string };
  marketplaceId: string;
  domains?: string[];
  keywords?: string[];
}

export interface PluginMarketplaceSnapshot {
  plugins: AgentPluginSummary[];
  sources: PluginMarketplaceSource[];
  refreshedAt: number;
  stale: boolean;
  warning?: string;
}
