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

/** A workspace-owned Git project. Repository paths live on runtime bindings. */
export type ProjectPrincipalType = "user" | "agent" | "role";

/** The principal performing a project operation. */
export interface ProjectPrincipal {
  type: ProjectPrincipalType;
  id: string;
}

export type ProjectCapability =
  "view" | "checkout" | "commit" | "publish" | "review" | "administer";

export const projectCapabilityLevels = [
  "view",
  "checkout",
  "commit",
  "publish",
  "review",
  "administer",
] as const satisfies readonly ProjectCapability[];

/** Every effective scope granted by one capability in the ordered hierarchy. */
export function projectCapabilitiesThrough(
  capability: ProjectCapability,
): ProjectCapability[] {
  return projectCapabilityLevels.slice(
    0,
    projectCapabilityLevels.indexOf(capability) + 1,
  );
}

/** The single grant that covers every requested capability. */
export function highestProjectCapability(
  capabilities: readonly ProjectCapability[],
): ProjectCapability {
  if (capabilities.length === 0) {
    throw new Error("At least one project capability is required.");
  }
  return capabilities.reduce((highest, capability) =>
    projectCapabilityLevels.indexOf(capability) >
    projectCapabilityLevels.indexOf(highest)
      ? capability
      : highest,
  );
}

/** Optional branch, environment, or expiry constraints on a project grant. */
export interface ProjectGrantConstraint {
  branches?: string[];
  expiresAt?: number;
}

/** One explicit project capability grant. */
export interface ProjectGrantRecord {
  id: string;
  organizationId: string;
  projectId: string;
  principalType: ProjectPrincipalType;
  principalId: string;
  capability: ProjectCapability;
  constraintJson?: ProjectGrantConstraint;
  createdAt: number;
  updatedAt: number;
}

export type ProviderConnectionStatus =
  "active" | "expired" | "revoked" | "error";

/** A workspace authorization to a hosted provider. Holds references, not secrets. */
export interface ProviderConnectionRecord {
  id: string;
  organizationId: string;
  providerId: "github" | "gitlab" | "bitbucket";
  installationId?: string;
  accountLabel?: string;
  secretReference?: string;
  status: ProviderConnectionStatus;
  createdAt: number;
  updatedAt: number;
}

/** Links one project to one provider connection and repository identifier. */
export interface ProjectProviderLinkRecord {
  id: string;
  organizationId: string;
  projectId: string;
  connectionId: string;
  providerRepositoryId: string;
  createdAt: number;
  updatedAt: number;
}

export type ProjectOperationType =
  | "attach"
  | "clone"
  | "list"
  | "inspect"
  | "browse"
  | "inspect_commit"
  | "compare"
  | "checkout"
  | "commit"
  | "publish"
  | "discard"
  | "release"
  | "remove"
  | "grant"
  | "denied";

export type ProjectOperationResult = "success" | "denied" | "failed";

/** Immutable, sanitized audit record. Never contains file contents or credentials. */
export interface ProjectOperationRecord {
  id: string;
  organizationId: string;
  projectId?: string;
  principalType?: ProjectPrincipalType;
  principalId?: string;
  agentId?: string;
  checkoutId?: string;
  branch?: string;
  operation: ProjectOperationType;
  result: ProjectOperationResult;
  commitHash?: string;
  correlationId?: string;
  message?: string;
  createdAt: number;
}

export type ProjectAccessRequestStatus = "pending" | "approved" | "denied";

/** An agent's effective project scopes, awaiting one human decision. */
export interface ProjectAccessRequestRecord {
  id: string;
  organizationId: string;
  projectId: string;
  agentId: string;
  capabilities: ProjectCapability[];
  status: ProjectAccessRequestStatus;
  requestedAt: number;
  resolvedAt?: number;
  resolvedBy?: string;
}

/** A short-lived credential scoped to one trusted operation. */
export interface ShortLivedCredential {
  username: string;
  password: string;
  expiresAt?: number;
}

/** What a credential broker is asked to provide for one Git operation. */
export interface CredentialRequest {
  organizationId: string;
  projectId: string;
  remoteUrl: string;
  operation: "fetch" | "push";
  scopes?: string[];
}

/** A hosted provider's identity for one repository. */
export interface ProviderRepositoryIdentity {
  providerId: "github" | "gitlab" | "bitbucket";
  repositoryId: string;
  cloneUrl: string;
  webUrl?: string;
}

/** A repository visible to a provider connection. */
export interface ProviderRepository {
  id: string;
  owner: string;
  name: string;
  defaultBranch: string;
  private: boolean;
  description?: string;
  avatarUrl?: string;
  cloneUrl: string;
  webUrl?: string;
}

export interface ProviderPullRequestInput {
  repositoryId: string;
  title: string;
  description?: string;
  headBranch: string;
  baseBranch: string;
}

export interface ProviderPullRequestUpdate {
  repositoryId: string;
  number: number;
  title?: string;
  description?: string;
  state?: "open" | "closed";
}

export interface ProviderPullRequest {
  number: number;
  title: string;
  description?: string;
  state: "open" | "closed" | "merged";
  headBranch: string;
  baseBranch: string;
  url?: string;
  createdAt: number;
  updatedAt: number;
}

export interface ProviderRefInput {
  repositoryId: string;
  ref: string;
}

export type ProviderCheckConclusion =
  | "success"
  | "failure"
  | "neutral"
  | "cancelled"
  | "skipped"
  | "timed_out"
  | "action_required";

export interface ProviderCheckSummary {
  name: string;
  status: "queued" | "in_progress" | "completed";
  conclusion?: ProviderCheckConclusion;
  startedAt?: number;
  completedAt?: number;
  url?: string;
}

/**
 * Hosted forge behavior behind the capability seam. Git transport stays
 * provider-neutral; generic Git keeps working without any adapter.
 */
export interface ProjectProviderAdapter {
  readonly id: "github" | "gitlab" | "bitbucket";
  resolveRemote(input: string): ProviderRepositoryIdentity | undefined;
  listRepositories(
    connectionId: string,
    query?: string,
    cursor?: string,
  ): Promise<{ repositories: ProviderRepository[]; nextCursor?: string }>;
  getRepository(
    connectionId: string,
    repositoryId: string,
  ): Promise<ProviderRepository>;
  createGitCredential(input: CredentialRequest): Promise<ShortLivedCredential>;
  createPullRequest(
    connectionId: string,
    input: ProviderPullRequestInput,
  ): Promise<ProviderPullRequest>;
  updatePullRequest(
    connectionId: string,
    input: ProviderPullRequestUpdate,
  ): Promise<ProviderPullRequest>;
  getChecks(input: ProviderRefInput): Promise<ProviderCheckSummary[]>;
}

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
  branchSummaries?: ProjectBranchSummary[];
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

/** A branch with its tip commit, for lists and empty states. */
export interface ProjectBranchSummary {
  name: string;
  shortHash: string;
  subject: string;
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

/** A bounded branch-to-branch comparison used before review or publish. */
export interface ProjectBranchComparison {
  projectId: string;
  baseRef: string;
  compareRef: string;
  mergeBase?: string;
  /** Commits in compareRef that are not in baseRef. */
  ahead: number;
  /** Commits in baseRef that are not in compareRef. */
  behind: number;
  commits: ProjectCommitSummary[];
  filesChanged: number;
  additions: number;
  deletions: number;
  patch: string;
  truncated: boolean;
  /** True when a three-way merge would conflict; undefined when unknown. */
  mergeConflict?: boolean;
  error?: string;
}
