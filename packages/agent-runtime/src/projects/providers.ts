import type { ProjectProviderId } from "../types.js";

export interface ProjectProviderResolution {
  id: ProjectProviderId;
  label: string;
  canonicalRemoteUrl?: string;
  repositoryWebUrl?: string;
}

/**
 * Hosted forge behavior lives behind this seam. Git transport and local
 * worktrees remain provider-neutral, so adding PRs or checks later does not
 * couple project storage to one vendor.
 */
export interface ProjectProviderAdapter {
  id: Exclude<ProjectProviderId, "local" | "generic-git">;
  label: string;
  hosts: readonly string[];
  repositoryWebUrl(remote: ParsedRemote): string | undefined;
}

interface ParsedRemote {
  canonicalUrl: string;
  host: string;
  path: string;
}

function parsedRemote(value: string): ParsedRemote | undefined {
  const trimmed = value.trim();
  const scp = /^[\w.-]+@([\w.-]+):(.+)$/.exec(trimmed);
  const [, scpHost, scpPath] = scp ?? [];
  if (scpHost && scpPath) {
    return {
      canonicalUrl: trimmed,
      host: scpHost.toLowerCase(),
      path: scpPath.replace(/^\/+|\/+$/g, "").replace(/\.git$/i, ""),
    };
  }
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "ssh:") url.username = "";
    url.password = "";
    return {
      canonicalUrl: url.toString(),
      host: url.hostname.toLowerCase(),
      path: url.pathname.replace(/^\/+|\/+$/g, "").replace(/\.git$/i, ""),
    };
  } catch {
    return undefined;
  }
}

function standardForge(
  id: ProjectProviderAdapter["id"],
  label: string,
  hosts: readonly string[],
): ProjectProviderAdapter {
  return {
    id,
    label,
    hosts,
    repositoryWebUrl: (remote) =>
      remote.path ? `https://${remote.host}/${remote.path}` : undefined,
  };
}

export const projectProviderAdapters: readonly ProjectProviderAdapter[] = [
  standardForge("github", "GitHub", ["github.com"]),
  standardForge("gitlab", "GitLab", ["gitlab.com"]),
  standardForge("bitbucket", "Bitbucket", ["bitbucket.org"]),
];

export function resolveProjectProvider(
  remoteUrl: string | undefined,
): ProjectProviderResolution {
  if (!remoteUrl) return { id: "local", label: "Local Git" };
  const remote = parsedRemote(remoteUrl);
  if (!remote) {
    return {
      id: "generic-git",
      label: "Git remote",
      canonicalRemoteUrl: remoteUrl,
    };
  }
  const adapter = projectProviderAdapters.find((candidate) =>
    candidate.hosts.includes(remote.host),
  );
  if (!adapter) {
    return {
      id: "generic-git",
      label: "Git remote",
      canonicalRemoteUrl: remote.canonicalUrl,
    };
  }
  return {
    id: adapter.id,
    label: adapter.label,
    canonicalRemoteUrl: remote.canonicalUrl,
    ...(adapter.repositoryWebUrl(remote)
      ? { repositoryWebUrl: adapter.repositoryWebUrl(remote) }
      : undefined),
  };
}

export function projectProviderLabel(providerId: ProjectProviderId) {
  if (providerId === "local") return "Local Git";
  if (providerId === "generic-git") return "Git remote";
  return (
    projectProviderAdapters.find((adapter) => adapter.id === providerId)
      ?.label ?? "Git remote"
  );
}

/** Capabilities a provider integration actually supports. Generic Git omits
 * hosted-forge features instead of pretending to support them. */
export interface ProjectProviderCapabilities {
  repositoryPicker: boolean;
  shortLivedCredentials: boolean;
  pullRequests: boolean;
  checks: boolean;
  reviews: boolean;
}

export function projectProviderCapabilities(
  providerId: ProjectProviderId,
): ProjectProviderCapabilities {
  if (providerId === "github") {
    return {
      repositoryPicker: true,
      shortLivedCredentials: true,
      pullRequests: true,
      checks: true,
      reviews: true,
    };
  }
  return {
    repositoryPicker: false,
    shortLivedCredentials: false,
    pullRequests: false,
    checks: false,
    reviews: false,
  };
}
