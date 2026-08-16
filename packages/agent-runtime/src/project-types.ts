export type ProjectRepositoryKind = "attached" | "cloned";
export type ProjectProviderId =
  "local" | "generic-git" | "github" | "gitlab" | "bitbucket";

/** A workspace-owned Git project. Repository paths live on runtime bindings. */
export interface ProjectRecord {
  id: string;
  organizationId: string;
  name: string;
  description?: string;
  repositoryKind: ProjectRepositoryKind;
  providerId: ProjectProviderId;
  canonicalRemoteUrl?: string;
  repositoryWebUrl?: string;
  defaultBranch: string;
  createdAt: number;
  updatedAt: number;
}

export type ProjectRepositoryBindingKind = "attached" | "materialized";

/** One runtime's local materialization of a shared workspace project. */
export interface ProjectRepositoryBindingRecord {
  id: string;
  organizationId: string;
  projectId: string;
  runtimeId: string;
  kind: ProjectRepositoryBindingKind;
  repositoryPath: string;
  createdAt: number;
  updatedAt: number;
}

export type ProjectCheckoutStrategy = "worktree" | "clone";
export type ProjectCheckoutStatus = "active" | "released";

/** A runtime-owned isolated checkout, represented by a worktree or clone. */
export interface ProjectCheckoutRecord {
  id: string;
  organizationId: string;
  projectId: string;
  runtimeId: string;
  agentId: string;
  agentIdentity: string;
  sessionId?: string;
  strategy: ProjectCheckoutStrategy;
  path: string;
  branch: string;
  baseRef: string;
  status: ProjectCheckoutStatus;
  createdAt: number;
  updatedAt: number;
}

export interface ProjectCommitSummary {
  hash: string;
  shortHash: string;
  parentHashes?: string[];
  subject: string;
  authorName: string;
  authorEmail: string;
  authoredAt: number;
}

export interface ProjectCommitDetail {
  projectId: string;
  ref: string;
  commit: ProjectCommitSummary;
  filesChanged: number;
  additions: number;
  deletions: number;
  patch: string;
  truncated: boolean;
}

export interface ProjectRepositorySnapshot {
  project: ProjectRecord;
  binding?: ProjectRepositoryBindingRecord;
  portable: boolean;
  available: boolean;
  branch?: string;
  head?: string;
  clean?: boolean;
  ahead?: number;
  behind?: number;
  changedFiles?: number;
  branches: string[];
  commits: ProjectCommitSummary[];
  checkouts: ProjectCheckoutRecord[];
  iconDataUrl?: string;
  error?: string;
}

export type ProjectTreeEntryType = "directory" | "file" | "submodule";

export interface ProjectTreeEntry {
  name: string;
  path: string;
  type: ProjectTreeEntryType;
  size?: number;
  lastCommit?: ProjectCommitSummary;
}

export interface ProjectContributorSummary {
  name: string;
  email: string;
  commits: number;
}

export interface ProjectReadmeSnapshot {
  path: string;
  content: string;
  truncated: boolean;
  imageSources?: Record<string, string>;
}

export interface ProjectFileSnapshot {
  path: string;
  size: number;
  content?: string;
  binary: boolean;
  truncated: boolean;
}

/** A committed repository view at one ref and path. */
export interface ProjectRepositoryBrowserSnapshot {
  projectId: string;
  ref: string;
  path: string;
  kind: "tree" | "file";
  latestCommit?: ProjectCommitSummary;
  commits: ProjectCommitSummary[];
  entries: ProjectTreeEntry[];
  contributors: ProjectContributorSummary[];
  readme?: ProjectReadmeSnapshot;
  file?: ProjectFileSnapshot;
}
