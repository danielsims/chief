import type {
  AgentPluginCatalogEntry,
  AgentPluginSummary,
} from "@chief/plugin-api";

export interface PortablePluginManifest {
  $schema: string;
  name: string;
  version?: string;
  description?: string;
  author?: { name?: string; email?: string; url?: string };
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
  skills: { name: string; description: string; path: string }[];
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
  version: 2;
  catalogSources: PluginCatalogSource[];
  installations: Record<string, PluginInstallRecord>;
}

export interface PluginCatalogSource {
  id: string;
  name: string;
  catalogUrl: string;
  homepage?: string;
  enabled: boolean;
  format: "agent-catalog" | "integrations-sh";
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
  catalogId: string;
  domains?: string[];
  keywords?: string[];
}

export interface PluginCatalogSnapshot {
  plugins: AgentPluginSummary[];
  sources: PluginCatalogSource[];
  refreshedAt: number;
  stale: boolean;
  warning?: string;
}
