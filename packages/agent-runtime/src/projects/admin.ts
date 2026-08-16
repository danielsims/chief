import { randomUUID } from "node:crypto";

import type {
  ProjectCapability,
  ProjectGrantRecord,
  ProjectPrincipal,
  ProviderConnectionRecord,
} from "../types.js";
import type { ProjectServiceAuthorization } from "./service-base.js";
import type { ProjectPersistence } from "./store.js";
import { ProjectServiceBase } from "./service-base.js";

export interface ProjectGrantInput {
  projectId: string;
  principal: ProjectPrincipal;
  capability: ProjectCapability;
  constraintJson?: {
    branches?: string[];
    expiresAt?: number;
  };
}

/** Project administration: removal, grants, audit, and provider references. */
export class ProjectAdministrationService extends ProjectServiceBase {
  constructor(
    persistence: ProjectPersistence,
    options: {
      root?: string;
      authorization?: ProjectServiceAuthorization;
    } = {},
  ) {
    super(persistence, options);
  }

  async remove(
    organizationId: string,
    projectId: string,
    principal: ProjectPrincipal,
  ) {
    await this.requireProject(organizationId, projectId);
    await this.authorize(organizationId, projectId, principal, "administer");
    await this.catalog.remove(organizationId, projectId);
    await this.recordOperation("remove", {
      organizationId,
      projectId,
      principal,
      result: "success",
    });
  }

  async listGrants(
    organizationId: string,
    projectId: string,
    principal: ProjectPrincipal,
  ) {
    const project = await this.requireProject(organizationId, projectId);
    await this.authorize(organizationId, projectId, principal, "view");
    return this.grantsStore.grants(organizationId, project.id);
  }

  async grant(
    organizationId: string,
    input: ProjectGrantInput,
    principal: ProjectPrincipal,
  ) {
    const project = await this.requireProject(organizationId, input.projectId);
    await this.authorize(organizationId, project.id, principal, "administer");
    const now = Date.now();
    const grant: ProjectGrantRecord = {
      id: randomUUID(),
      organizationId,
      projectId: project.id,
      principalType: input.principal.type,
      principalId: input.principal.id,
      capability: input.capability,
      ...(input.constraintJson ? { constraintJson: input.constraintJson } : {}),
      createdAt: now,
      updatedAt: now,
    };
    const saved = await this.grantsStore.saveGrant(grant);
    await this.recordOperation("grant", {
      organizationId,
      projectId: project.id,
      principal,
      result: "success",
    });
    return saved;
  }

  async revokeGrant(
    organizationId: string,
    projectId: string,
    grantId: string,
    principal: ProjectPrincipal,
  ) {
    const project = await this.requireProject(organizationId, projectId);
    await this.authorize(organizationId, project.id, principal, "administer");
    await this.grantsStore.revokeGrant(organizationId, grantId);
    await this.recordOperation("grant", {
      organizationId,
      projectId: project.id,
      principal,
      result: "success",
    });
  }

  async operations(
    organizationId: string,
    principal: ProjectPrincipal,
    projectId?: string,
    limit?: number,
  ) {
    if (projectId) {
      await this.authorize(organizationId, projectId, principal, "view");
    } else {
      await this.authorizeCreation(organizationId, principal);
    }
    return this.operationsStore.listOperations(
      organizationId,
      projectId,
      limit,
    );
  }

  async providerConnections(
    organizationId: string,
    principal: ProjectPrincipal,
  ) {
    await this.authorizeCreation(organizationId, principal);
    return this.providersStore.listConnections(organizationId);
  }

  async saveProviderConnection(
    organizationId: string,
    connection: ProviderConnectionRecord,
    principal: ProjectPrincipal,
  ) {
    await this.authorizeCreation(organizationId, principal);
    if (connection.organizationId !== organizationId) {
      throw new Error("Provider connection does not belong to this workspace.");
    }
    return this.providersStore.saveConnection(connection);
  }

  async saveProviderLink(
    organizationId: string,
    projectId: string,
    connectionId: string,
    providerRepositoryId: string,
    principal: ProjectPrincipal,
  ) {
    const project = await this.requireProject(organizationId, projectId);
    await this.authorize(organizationId, project.id, principal, "administer");
    const now = Date.now();
    return this.providersStore.saveLink({
      id: randomUUID(),
      organizationId,
      projectId: project.id,
      connectionId,
      providerRepositoryId,
      createdAt: now,
      updatedAt: now,
    });
  }
}
