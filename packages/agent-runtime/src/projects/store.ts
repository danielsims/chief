import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { and, desc, eq } from "drizzle-orm";

import type {
  ProjectCheckoutRecord,
  ProjectRecord,
  ProjectRepositoryBindingRecord,
} from "../types.js";
import * as schema from "../db/schema.js";

type Database = LibSQLDatabase;

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

export interface ProjectPersistence {
  catalog: ProjectCatalogStore;
  runtime: ProjectRuntimeStore;
}

function projectRecord(
  row: typeof schema.projects.$inferSelect,
): ProjectRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    name: row.name,
    ...(row.description ? { description: row.description } : {}),
    repositoryKind: row.repositoryKind,
    providerId: row.providerId,
    ...(row.canonicalRemoteUrl
      ? { canonicalRemoteUrl: row.canonicalRemoteUrl }
      : {}),
    ...(row.repositoryWebUrl ? { repositoryWebUrl: row.repositoryWebUrl } : {}),
    defaultBranch: row.defaultBranch,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function bindingRecord(
  row: typeof schema.projectRepositoryBindings.$inferSelect,
): ProjectRepositoryBindingRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    projectId: row.projectId,
    runtimeId: row.runtimeId,
    kind: row.kind,
    repositoryPath: row.repositoryPath,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function checkoutRecord(
  row: typeof schema.projectCheckouts.$inferSelect,
): ProjectCheckoutRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    projectId: row.projectId,
    runtimeId: row.runtimeId,
    agentId: row.agentId,
    agentIdentity: row.agentIdentity,
    ...(row.sessionId ? { sessionId: row.sessionId } : {}),
    strategy: row.strategy,
    path: row.path,
    branch: row.branch,
    baseRef: row.baseRef,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Tenant-scoped persistence for real repositories and isolated checkouts. */
export class ProjectStore implements ProjectCatalogStore, ProjectRuntimeStore {
  constructor(
    private readonly database: () => Database,
    private readonly ready: Promise<void>,
  ) {}

  async save(project: ProjectRecord) {
    await this.ready;
    await this.database()
      .insert(schema.projects)
      .values(project)
      .onConflictDoUpdate({
        target: [schema.projects.organizationId, schema.projects.id],
        set: {
          name: project.name,
          description: project.description,
          repositoryKind: project.repositoryKind,
          providerId: project.providerId,
          canonicalRemoteUrl: project.canonicalRemoteUrl,
          repositoryWebUrl: project.repositoryWebUrl,
          defaultBranch: project.defaultBranch,
          updatedAt: project.updatedAt,
        },
      })
      .run();
    return project;
  }

  async get(organizationId: string, projectId: string) {
    await this.ready;
    const row = await this.database()
      .select()
      .from(schema.projects)
      .where(
        and(
          eq(schema.projects.organizationId, organizationId),
          eq(schema.projects.id, projectId),
        ),
      )
      .get();
    return row ? projectRecord(row) : undefined;
  }

  async list(organizationId: string) {
    await this.ready;
    const rows = await this.database()
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.organizationId, organizationId))
      .orderBy(desc(schema.projects.updatedAt))
      .all();
    return rows.map(projectRecord);
  }

  async findByRemote(organizationId: string, canonicalRemoteUrl: string) {
    await this.ready;
    const row = await this.database()
      .select()
      .from(schema.projects)
      .where(
        and(
          eq(schema.projects.organizationId, organizationId),
          eq(schema.projects.canonicalRemoteUrl, canonicalRemoteUrl),
        ),
      )
      .get();
    return row ? projectRecord(row) : undefined;
  }

  async saveBinding(binding: ProjectRepositoryBindingRecord) {
    await this.ready;
    const project = await this.get(binding.organizationId, binding.projectId);
    if (!project) throw new Error("Project does not belong to this workspace.");
    await this.database()
      .insert(schema.projectRepositoryBindings)
      .values(binding)
      .onConflictDoUpdate({
        target: [
          schema.projectRepositoryBindings.organizationId,
          schema.projectRepositoryBindings.runtimeId,
          schema.projectRepositoryBindings.projectId,
        ],
        set: {
          kind: binding.kind,
          repositoryPath: binding.repositoryPath,
          updatedAt: binding.updatedAt,
        },
      })
      .run();
    return binding;
  }

  async binding(organizationId: string, projectId: string, runtimeId: string) {
    await this.ready;
    const row = await this.database()
      .select()
      .from(schema.projectRepositoryBindings)
      .where(
        and(
          eq(schema.projectRepositoryBindings.organizationId, organizationId),
          eq(schema.projectRepositoryBindings.projectId, projectId),
          eq(schema.projectRepositoryBindings.runtimeId, runtimeId),
        ),
      )
      .get();
    return row ? bindingRecord(row) : undefined;
  }

  async remove(organizationId: string, projectId: string) {
    await this.ready;
    const active = await this.listCheckouts(organizationId, projectId, true);
    if (active.length > 0) {
      throw new Error("Release the project's active agent checkouts first.");
    }
    const result = await this.database()
      .delete(schema.projects)
      .where(
        and(
          eq(schema.projects.organizationId, organizationId),
          eq(schema.projects.id, projectId),
        ),
      )
      .run();
    return result.rowsAffected > 0;
  }

  async saveCheckout(checkout: ProjectCheckoutRecord) {
    await this.ready;
    const project = await this.get(checkout.organizationId, checkout.projectId);
    if (!project) throw new Error("Project does not belong to this workspace.");
    await this.database()
      .insert(schema.projectCheckouts)
      .values(checkout)
      .onConflictDoUpdate({
        target: [
          schema.projectCheckouts.organizationId,
          schema.projectCheckouts.id,
        ],
        set: {
          agentId: checkout.agentId,
          runtimeId: checkout.runtimeId,
          agentIdentity: checkout.agentIdentity,
          sessionId: checkout.sessionId,
          strategy: checkout.strategy,
          path: checkout.path,
          branch: checkout.branch,
          baseRef: checkout.baseRef,
          status: checkout.status,
          updatedAt: checkout.updatedAt,
        },
      })
      .run();
    return checkout;
  }

  async checkout(organizationId: string, checkoutId: string) {
    await this.ready;
    const row = await this.database()
      .select()
      .from(schema.projectCheckouts)
      .where(
        and(
          eq(schema.projectCheckouts.organizationId, organizationId),
          eq(schema.projectCheckouts.id, checkoutId),
        ),
      )
      .get();
    return row ? checkoutRecord(row) : undefined;
  }

  async listCheckouts(
    organizationId: string,
    projectId: string,
    activeOnly = false,
    runtimeId?: string,
  ) {
    await this.ready;
    const predicates = [
      eq(schema.projectCheckouts.organizationId, organizationId),
      eq(schema.projectCheckouts.projectId, projectId),
    ];
    if (activeOnly) {
      predicates.push(eq(schema.projectCheckouts.status, "active"));
    }
    if (runtimeId) {
      predicates.push(eq(schema.projectCheckouts.runtimeId, runtimeId));
    }
    const rows = await this.database()
      .select()
      .from(schema.projectCheckouts)
      .where(and(...predicates))
      .orderBy(desc(schema.projectCheckouts.updatedAt))
      .all();
    return rows.map(checkoutRecord);
  }
}
