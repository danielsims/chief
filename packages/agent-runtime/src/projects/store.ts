import type {
  ProjectCheckoutRecord,
  ProjectGrantRecord,
  ProjectOperationRecord,
  ProjectPrincipalType,
  ProjectProviderLinkRecord,
  ProjectRecord,
  ProjectRepositoryBindingRecord,
  ProviderConnectionRecord,
} from "../types.js";

/** Workspace-shared project metadata. Implementations may be local or hosted. */
export interface ProjectCatalogStore {
  save(project: ProjectRecord): Promise<ProjectRecord>;
  get(
    organizationId: string,
    projectId: string,
  ): Promise<ProjectRecord | undefined>;
  list(organizationId: string): Promise<ProjectRecord[]>;
  findByRemote(
    organizationId: string,
    canonicalRemoteUrl: string,
  ): Promise<ProjectRecord | undefined>;
  remove(organizationId: string, projectId: string): Promise<boolean>;
}

/** Runtime-private repository paths and agent checkout state. */
export interface ProjectRuntimeStore {
  saveBinding(
    binding: ProjectRepositoryBindingRecord,
  ): Promise<ProjectRepositoryBindingRecord>;
  binding(
    organizationId: string,
    projectId: string,
    runtimeId: string,
  ): Promise<ProjectRepositoryBindingRecord | undefined>;
  saveCheckout(checkout: ProjectCheckoutRecord): Promise<ProjectCheckoutRecord>;
  checkout(
    organizationId: string,
    checkoutId: string,
  ): Promise<ProjectCheckoutRecord | undefined>;
  listCheckouts(
    organizationId: string,
    projectId: string,
    activeOnly?: boolean,
    runtimeId?: string,
  ): Promise<ProjectCheckoutRecord[]>;
}

/** Explicit capability grants for a project. */
export interface ProjectGrantStore {
  grants(
    organizationId: string,
    projectId: string,
    principal?: { type: ProjectPrincipalType; id: string },
  ): Promise<ProjectGrantRecord[]>;
  saveGrant(grant: ProjectGrantRecord): Promise<ProjectGrantRecord>;
  revokeGrant(organizationId: string, grantId: string): Promise<boolean>;
}

/** Provider connection references and project links. Never holds secrets. */
export interface ProjectProviderStore {
  saveConnection(
    connection: ProviderConnectionRecord,
  ): Promise<ProviderConnectionRecord>;
  connection(
    organizationId: string,
    connectionId: string,
  ): Promise<ProviderConnectionRecord | undefined>;
  listConnections(organizationId: string): Promise<ProviderConnectionRecord[]>;
  saveLink(link: ProjectProviderLinkRecord): Promise<ProjectProviderLinkRecord>;
  link(
    organizationId: string,
    projectId: string,
    connectionId: string,
  ): Promise<ProjectProviderLinkRecord | undefined>;
  listLinks(
    organizationId: string,
    projectId: string,
  ): Promise<ProjectProviderLinkRecord[]>;
}

/** Immutable, sanitized operation audit records. */
export interface ProjectOperationStore {
  saveOperation(
    operation: ProjectOperationRecord,
  ): Promise<ProjectOperationRecord>;
  listOperations(
    organizationId: string,
    projectId?: string,
    limit?: number,
  ): Promise<ProjectOperationRecord[]>;
}

/** One tenant-scoped persistence bundle shared by all project services. */
export interface ProjectPersistence {
  catalog: ProjectCatalogStore;
  runtime: ProjectRuntimeStore;
  grants: ProjectGrantStore;
  providers: ProjectProviderStore;
  operations: ProjectOperationStore;
}
