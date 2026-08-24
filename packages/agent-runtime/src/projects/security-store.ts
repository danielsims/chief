import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { and, asc, desc, eq } from "drizzle-orm";

import type {
  ProjectAccessRequestRecord,
  ProjectGrantRecord,
  ProjectOperationRecord,
  ProjectPrincipalType,
  ProjectProviderLinkRecord,
  ProviderConnectionRecord,
} from "../types.js";
import type {
  ProjectAccessRequestStore,
  ProjectGrantStore,
  ProjectOperationStore,
  ProjectProviderStore,
} from "./store.js";
import * as schema from "../db/schema.js";
import {
  highestProjectCapability,
  projectCapabilitiesThrough,
} from "../project-types.js";

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
    ...(row.constraintJson
      ? { constraintJson: row.constraintJson }
      : undefined),
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
    ...(row.installationId
      ? { installationId: row.installationId }
      : undefined),
    ...(row.accountLabel ? { accountLabel: row.accountLabel } : undefined),
    ...(row.secretReference
      ? { secretReference: row.secretReference }
      : undefined),
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
    ...(row.projectId ? { projectId: row.projectId } : undefined),
    ...(row.principalType ? { principalType: row.principalType } : undefined),
    ...(row.principalId ? { principalId: row.principalId } : undefined),
    ...(row.agentId ? { agentId: row.agentId } : undefined),
    ...(row.checkoutId ? { checkoutId: row.checkoutId } : undefined),
    ...(row.branch ? { branch: row.branch } : undefined),
    operation: row.operation,
    result: row.result,
    ...(row.commitHash ? { commitHash: row.commitHash } : undefined),
    ...(row.correlationId ? { correlationId: row.correlationId } : undefined),
    ...(row.message ? { message: row.message } : undefined),
    createdAt: row.createdAt,
  };
}

function accessRequestRecord(
  row: typeof schema.projectAccessRequests.$inferSelect,
): ProjectAccessRequestRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    projectId: row.projectId,
    agentId: row.agentId,
    capabilities: projectCapabilitiesThrough(row.capability),
    status: row.status,
    requestedAt: row.requestedAt,
    ...(row.resolvedAt ? { resolvedAt: row.resolvedAt } : undefined),
    ...(row.resolvedBy ? { resolvedBy: row.resolvedBy } : undefined),
  };
}

/** Tenant-scoped grants, provider references, access requests, and audit. */
export class ProjectSecurityStore
  implements
    ProjectGrantStore,
    ProjectProviderStore,
    ProjectOperationStore,
    ProjectAccessRequestStore
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

  async saveAccessRequest(request: ProjectAccessRequestRecord) {
    await this.ready;
    const { capabilities, ...record } = request;
    await this.database()
      .insert(schema.projectAccessRequests)
      .values({
        ...record,
        capability: highestProjectCapability(capabilities),
      });
    return request;
  }

  async accessRequest(organizationId: string, requestId: string) {
    await this.ready;
    const row = await this.database()
      .select()
      .from(schema.projectAccessRequests)
      .where(
        and(
          eq(schema.projectAccessRequests.organizationId, organizationId),
          eq(schema.projectAccessRequests.id, requestId),
        ),
      )
      .get();
    return row ? accessRequestRecord(row) : undefined;
  }

  async pendingAccessRequests(organizationId: string) {
    await this.ready;
    const rows = await this.database()
      .select()
      .from(schema.projectAccessRequests)
      .where(
        and(
          eq(schema.projectAccessRequests.organizationId, organizationId),
          eq(schema.projectAccessRequests.status, "pending"),
        ),
      )
      .orderBy(asc(schema.projectAccessRequests.requestedAt))
      .all();
    return rows.map(accessRequestRecord);
  }

  async resolveAccessRequest(
    organizationId: string,
    requestId: string,
    status: "approved" | "denied",
    resolvedBy: string,
  ) {
    await this.ready;
    const resolvedAt = Date.now();
    const result = await this.database()
      .update(schema.projectAccessRequests)
      .set({
        status,
        resolvedAt,
        resolvedBy,
      })
      .where(
        and(
          eq(schema.projectAccessRequests.organizationId, organizationId),
          eq(schema.projectAccessRequests.id, requestId),
          eq(schema.projectAccessRequests.status, "pending"),
        ),
      )
      .run();
    if (result.rowsAffected === 0) return undefined;
    return this.accessRequest(organizationId, requestId);
  }
}
