import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { and, desc, eq } from "drizzle-orm";

import type {
  ProjectGrantRecord,
  ProjectOperationRecord,
  ProjectPrincipalType,
  ProjectProviderLinkRecord,
  ProviderConnectionRecord,
} from "../types.js";
import type {
  ProjectGrantStore,
  ProjectOperationStore,
  ProjectProviderStore,
} from "./store.js";
import * as schema from "../db/schema.js";

type Database = LibSQLDatabase;

function grantRecord(
  row: typeof schema.projectGrants.$inferSelect,
): ProjectGrantRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    projectId: row.projectId,
    principalType: row.principalType,
    principalId: row.principalId,
    capability: row.capability,
    ...(row.constraintJson ? { constraintJson: row.constraintJson } : {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function providerConnectionRecord(
  row: typeof schema.providerConnections.$inferSelect,
): ProviderConnectionRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    providerId: row.providerId,
    ...(row.installationId ? { installationId: row.installationId } : {}),
    ...(row.accountLabel ? { accountLabel: row.accountLabel } : {}),
    ...(row.secretReference ? { secretReference: row.secretReference } : {}),
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function providerLinkRecord(
  row: typeof schema.projectProviderLinks.$inferSelect,
): ProjectProviderLinkRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    projectId: row.projectId,
    connectionId: row.connectionId,
    providerRepositoryId: row.providerRepositoryId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function operationRecord(
  row: typeof schema.projectOperations.$inferSelect,
): ProjectOperationRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    ...(row.projectId ? { projectId: row.projectId } : {}),
    ...(row.principalType ? { principalType: row.principalType } : {}),
    ...(row.principalId ? { principalId: row.principalId } : {}),
    ...(row.agentId ? { agentId: row.agentId } : {}),
    ...(row.checkoutId ? { checkoutId: row.checkoutId } : {}),
    ...(row.branch ? { branch: row.branch } : {}),
    operation: row.operation,
    result: row.result,
    ...(row.commitHash ? { commitHash: row.commitHash } : {}),
    ...(row.correlationId ? { correlationId: row.correlationId } : {}),
    ...(row.message ? { message: row.message } : {}),
    createdAt: row.createdAt,
  };
}

/** Tenant-scoped grants, provider references, and audit persistence. */
export class ProjectSecurityStore
  implements ProjectGrantStore, ProjectProviderStore, ProjectOperationStore
{
  constructor(
    private readonly database: () => Database,
    private readonly ready: Promise<void>,
  ) {}

  async grants(
    organizationId: string,
    projectId: string,
    principal?: { type: ProjectPrincipalType; id: string },
  ) {
    await this.ready;
    const predicates = [
      eq(schema.projectGrants.organizationId, organizationId),
      eq(schema.projectGrants.projectId, projectId),
    ];
    if (principal) {
      predicates.push(
        eq(schema.projectGrants.principalType, principal.type),
        eq(schema.projectGrants.principalId, principal.id),
      );
    }
    const rows = await this.database()
      .select()
      .from(schema.projectGrants)
      .where(and(...predicates))
      .orderBy(desc(schema.projectGrants.createdAt))
      .all();
    return rows.map(grantRecord);
  }

  async saveGrant(grant: ProjectGrantRecord) {
    await this.ready;
    const project = await this.database()
      .select({ id: schema.projects.id })
      .from(schema.projects)
      .where(
        and(
          eq(schema.projects.organizationId, grant.organizationId),
          eq(schema.projects.id, grant.projectId),
        ),
      )
      .get();
    if (!project) throw new Error("Project does not belong to this workspace.");
    await this.database()
      .insert(schema.projectGrants)
      .values(grant)
      .onConflictDoUpdate({
        target: [
          schema.projectGrants.organizationId,
          schema.projectGrants.projectId,
          schema.projectGrants.principalType,
          schema.projectGrants.principalId,
          schema.projectGrants.capability,
        ],
        set: {
          constraintJson: grant.constraintJson,
          updatedAt: grant.updatedAt,
        },
      })
      .run();
    return grant;
  }

  async revokeGrant(organizationId: string, grantId: string) {
    await this.ready;
    const result = await this.database()
      .delete(schema.projectGrants)
      .where(
        and(
          eq(schema.projectGrants.organizationId, organizationId),
          eq(schema.projectGrants.id, grantId),
        ),
      )
      .run();
    return result.rowsAffected > 0;
  }

  async saveConnection(connection: ProviderConnectionRecord) {
    await this.ready;
    await this.database()
      .insert(schema.providerConnections)
      .values(connection)
      .onConflictDoUpdate({
        target: [
          schema.providerConnections.organizationId,
          schema.providerConnections.id,
        ],
        set: {
          installationId: connection.installationId,
          accountLabel: connection.accountLabel,
          secretReference: connection.secretReference,
          status: connection.status,
          updatedAt: connection.updatedAt,
        },
      })
      .run();
    return connection;
  }

  async connection(organizationId: string, connectionId: string) {
    await this.ready;
    const row = await this.database()
      .select()
      .from(schema.providerConnections)
      .where(
        and(
          eq(schema.providerConnections.organizationId, organizationId),
          eq(schema.providerConnections.id, connectionId),
        ),
      )
      .get();
    return row ? providerConnectionRecord(row) : undefined;
  }

  async listConnections(organizationId: string) {
    await this.ready;
    const rows = await this.database()
      .select()
      .from(schema.providerConnections)
      .where(eq(schema.providerConnections.organizationId, organizationId))
      .orderBy(desc(schema.providerConnections.updatedAt))
      .all();
    return rows.map(providerConnectionRecord);
  }

  async saveLink(link: ProjectProviderLinkRecord) {
    await this.ready;
    const project = await this.database()
      .select({ id: schema.projects.id })
      .from(schema.projects)
      .where(
        and(
          eq(schema.projects.organizationId, link.organizationId),
          eq(schema.projects.id, link.projectId),
        ),
      )
      .get();
    if (!project) throw new Error("Project does not belong to this workspace.");
    const connection = await this.connection(
      link.organizationId,
      link.connectionId,
    );
    if (!connection) {
      throw new Error("Provider connection does not belong to this workspace.");
    }
    await this.database()
      .insert(schema.projectProviderLinks)
      .values(link)
      .onConflictDoUpdate({
        target: [
          schema.projectProviderLinks.organizationId,
          schema.projectProviderLinks.projectId,
          schema.projectProviderLinks.connectionId,
        ],
        set: {
          providerRepositoryId: link.providerRepositoryId,
          updatedAt: link.updatedAt,
        },
      })
      .run();
    return link;
  }

  async link(organizationId: string, projectId: string, connectionId: string) {
    await this.ready;
    const row = await this.database()
      .select()
      .from(schema.projectProviderLinks)
      .where(
        and(
          eq(schema.projectProviderLinks.organizationId, organizationId),
          eq(schema.projectProviderLinks.projectId, projectId),
          eq(schema.projectProviderLinks.connectionId, connectionId),
        ),
      )
      .get();
    return row ? providerLinkRecord(row) : undefined;
  }

  async listLinks(organizationId: string, projectId: string) {
    await this.ready;
    const rows = await this.database()
      .select()
      .from(schema.projectProviderLinks)
      .where(
        and(
          eq(schema.projectProviderLinks.organizationId, organizationId),
          eq(schema.projectProviderLinks.projectId, projectId),
        ),
      )
      .all();
    return rows.map(providerLinkRecord);
  }

  async saveOperation(operation: ProjectOperationRecord) {
    await this.ready;
    await this.database().insert(schema.projectOperations).values(operation);
    return operation;
  }

  async listOperations(
    organizationId: string,
    projectId?: string,
    limit = 200,
  ) {
    await this.ready;
    const predicates = [
      eq(schema.projectOperations.organizationId, organizationId),
    ];
    if (projectId) {
      predicates.push(eq(schema.projectOperations.projectId, projectId));
    }
    const rows = await this.database()
      .select()
      .from(schema.projectOperations)
      .where(and(...predicates))
      .orderBy(desc(schema.projectOperations.createdAt))
      .limit(limit)
      .all();
    return rows.map(operationRecord);
  }
}
