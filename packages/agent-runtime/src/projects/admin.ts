import { randomUUID } from "node:crypto";

import type {
  ProjectAccessRequestRecord,
  ProjectCapability,
  ProjectGrantRecord,
  ProjectPrincipal,
  ProviderConnectionRecord,
} from "../types.js";
import type { ProjectServiceAuthorization } from "./service-base.js";
import type { ProjectPersistence } from "./store.js";
import {
  highestProjectCapability,
  projectCapabilitiesThrough,
} from "../project-types.js";
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

/** Project administration: removal, grants, audit, access requests, provider references. */
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

  /**
   * Requests every project scope an agent needs in one decision. The request stays pending
   * until a workspace operator approves or denies it; nothing is granted by
   * the agent itself.
   */
  async requestProjectAccess(
    organizationId: string,
    projectId: string,
    agentId: string,
    capabilities: readonly ProjectCapability[],
  ) {
    const project = await this.requireProject(organizationId, projectId);
    const highestCapability = highestProjectCapability(capabilities);
    const effectiveCapabilities = projectCapabilitiesThrough(highestCapability);
    const existing = (
      await this.accessRequestsStore.pendingAccessRequests(organizationId)
    ).find(
      (request) =>
        request.projectId === project.id &&
        request.agentId === agentId &&
        request.capabilities.at(-1) === highestCapability,
    );
    if (existing) return existing;
    const now = Date.now();
    const request: ProjectAccessRequestRecord = {
      id: randomUUID(),
      organizationId,
      projectId: project.id,
      agentId,
      capabilities: effectiveCapabilities,
      status: "pending",
      requestedAt: now,
    };
    const saved = await this.accessRequestsStore.saveAccessRequest(request);
    await this.recordOperation("grant", {
      organizationId,
      projectId: project.id,
      principal: { type: "agent", id: agentId },
      result: "success",
      message: `Requested ${effectiveCapabilities.join(", ")} access; awaiting approval.`,
    });
    return saved;
  }

  async pendingAccessRequests(
    organizationId: string,
    principal: ProjectPrincipal,
  ) {
    await this.authorizeCreation(organizationId, principal);
    return this.accessRequestsStore.pendingAccessRequests(organizationId);
  }

  async approveProjectAccess(
    organizationId: string,
    requestId: string,
    principal: ProjectPrincipal,
  ) {
    const request = await this.requireAccessRequest(organizationId, requestId);
    await this.authorize(
      organizationId,
      request.projectId,
      principal,
      "administer",
    );
    const approved = await this.accessRequestsStore.resolveAccessRequest(
      organizationId,
      requestId,
      "approved",
      principal.id,
    );
    if (!approved) throw new Error("This access request is no longer pending.");
    const capability = request.capabilities.at(-1);
    if (!capability)
      throw new Error("This access request has no capabilities.");
    const now = Date.now();
    await this.grantsStore.saveGrant({
      id: randomUUID(),
      organizationId,
      projectId: request.projectId,
      principalType: "agent",
      principalId: request.agentId,
      capability,
      createdAt: now,
      updatedAt: now,
    });
    await this.recordOperation("grant", {
      organizationId,
      projectId: request.projectId,
      principal,
      result: "success",
      message: `Approved ${request.capabilities.join(", ")} for agent ${request.agentId}.`,
    });
    return approved;
  }

  async denyProjectAccess(
    organizationId: string,
    requestId: string,
    principal: ProjectPrincipal,
  ) {
    const request = await this.requireAccessRequest(organizationId, requestId);
    await this.authorize(
      organizationId,
      request.projectId,
      principal,
      "administer",
    );
    const denied = await this.accessRequestsStore.resolveAccessRequest(
      organizationId,
      requestId,
      "denied",
      principal.id,
    );
    if (!denied) throw new Error("This access request is no longer pending.");
    await this.recordOperation("denied", {
      organizationId,
      projectId: request.projectId,
      principal,
      result: "denied",
      message: `Denied ${request.capabilities.join(", ")} for agent ${request.agentId}.`,
    });
    return denied;
  }

  private async requireAccessRequest(
    organizationId: string,
    requestId: string,
  ) {
    const request = await this.accessRequestsStore.accessRequest(
      organizationId,
      requestId,
    );
    if (!request) {
      throw new Error("This access request does not belong to the workspace.");
    }
    return request;
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
