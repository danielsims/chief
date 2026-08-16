import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type {
  ProjectCapability,
  ProjectOperationRecord,
  ProjectOperationType,
  ProjectPrincipal,
  ProjectRecord,
  ProjectRepositoryBindingRecord,
} from "../project-types.js";
import type {
  ProjectCatalogStore,
  ProjectGrantStore,
  ProjectOperationStore,
  ProjectPersistence,
  ProjectProviderStore,
  ProjectRuntimeStore,
} from "./store.js";
import { ProjectAuthorizationError } from "./authorization.js";
import {
  git,
  repositoryRoot,
  safeSegment,
  workspaceSegment,
} from "./repository-git.js";

/** The subset of the authorization service the project services rely on. */
export interface ProjectServiceAuthorization {
  authorize(input: {
    organizationId: string;
    projectId: string;
    principal: ProjectPrincipal;
    capability: ProjectCapability;
    targetRef?: string;
  }): Promise<void>;
  authorizeCreation(
    organizationId: string,
    principal: ProjectPrincipal,
  ): Promise<void>;
}

/** Shared persistence access, authorization, and audit recording for project services. */
export abstract class ProjectServiceBase {
  private readonly persistence: ProjectPersistence;
  private readonly authorization: ProjectServiceAuthorization | undefined;
  private runtimeIdPromise?: Promise<string>;
  readonly root: string;
  protected readonly repositoriesRoot: string;

  constructor(
    persistence: ProjectPersistence,
    options: {
      root?: string;
      authorization?: ProjectServiceAuthorization;
    } = {},
  ) {
    this.persistence = persistence;
    this.authorization = options.authorization;
    this.root = options.root ?? process.cwd();
    this.repositoriesRoot = join(this.root, "repositories");
  }

  protected get catalog(): ProjectCatalogStore {
    return this.persistence.catalog;
  }

  protected get runtime(): ProjectRuntimeStore {
    return this.persistence.runtime;
  }

  protected get grantsStore(): ProjectGrantStore {
    return this.persistence.grants;
  }

  protected get providersStore(): ProjectProviderStore {
    return this.persistence.providers;
  }

  protected get operationsStore(): ProjectOperationStore {
    return this.persistence.operations;
  }

  protected runtimeId() {
    this.runtimeIdPromise ??= (async () => {
      const path = `${this.root}/runtime-id`;
      try {
        const existing = (await readFile(path, "utf8")).trim();
        if (existing) return existing;
      } catch {
        // The first run creates a stable, opaque runtime identity below.
      }
      await mkdir(this.root, { recursive: true, mode: 0o700 });
      const id = randomUUID();
      await writeFile(path, `${id}\n`, { encoding: "utf8", mode: 0o600 });
      return id;
    })();
    return this.runtimeIdPromise;
  }

  /** The stable person principal that operates this workspace on this runtime. */
  async operatorPrincipal(organizationId: string): Promise<ProjectPrincipal> {
    const runtimeId = await this.runtimeId();
    const id = `op-${createHash("sha256")
      .update(`${organizationId}:${runtimeId}`)
      .digest("hex")
      .slice(0, 16)}`;
    return { type: "user", id };
  }

  protected async authorize(
    organizationId: string,
    projectId: string,
    principal: ProjectPrincipal,
    capability: ProjectCapability,
    targetRef?: string,
  ) {
    if (!this.authorization) return;
    try {
      await this.authorization.authorize({
        organizationId,
        projectId,
        principal,
        capability,
        ...(targetRef ? { targetRef } : {}),
      });
    } catch (error) {
      if (error instanceof ProjectAuthorizationError) {
        await this.recordOperation("denied", {
          organizationId,
          projectId,
          principal,
          ...(targetRef ? { branch: targetRef } : {}),
          result: "denied",
          message: error.message,
        });
      }
      throw error;
    }
  }

  protected async authorizeCreation(
    organizationId: string,
    principal: ProjectPrincipal,
  ) {
    if (!this.authorization) return;
    await this.authorization.authorizeCreation(organizationId, principal);
  }

  protected async recordOperation(
    operation: ProjectOperationType,
    input: {
      organizationId: string;
      result: ProjectOperationRecord["result"];
      projectId?: string;
      principal?: ProjectPrincipal;
      agentId?: string;
      checkoutId?: string;
      branch?: string;
      commitHash?: string;
      message?: string;
    },
  ) {
    const record: ProjectOperationRecord = {
      id: randomUUID(),
      organizationId: input.organizationId,
      ...(input.projectId ? { projectId: input.projectId } : {}),
      ...(input.principal
        ? {
            principalType: input.principal.type,
            principalId: input.principal.id,
          }
        : {}),
      ...(input.agentId ? { agentId: input.agentId } : {}),
      ...(input.checkoutId ? { checkoutId: input.checkoutId } : {}),
      ...(input.branch ? { branch: input.branch } : {}),
      operation,
      result: input.result,
      ...(input.commitHash ? { commitHash: input.commitHash } : {}),
      ...(input.message
        ? { message: input.message.trim().replace(/\s+/g, " ").slice(0, 240) }
        : {}),
      createdAt: Date.now(),
    };
    await this.operationsStore.saveOperation(record);
  }

  protected async requireProject(organizationId: string, projectId: string) {
    const project = await this.catalog.get(organizationId, projectId);
    if (!project) throw new Error("Project does not belong to this workspace.");
    return project;
  }

  protected async bindRepository(
    project: ProjectRecord,
    repositoryPath: string,
    kind: ProjectRepositoryBindingRecord["kind"],
  ) {
    const runtimeId = await this.runtimeId();
    const existing = await this.runtime.binding(
      project.organizationId,
      project.id,
      runtimeId,
    );
    const now = Date.now();
    return this.runtime.saveBinding({
      id: existing?.id ?? randomUUID(),
      organizationId: project.organizationId,
      projectId: project.id,
      runtimeId,
      kind,
      repositoryPath,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
  }

  protected async ensureBinding(project: ProjectRecord) {
    const runtimeId = await this.runtimeId();
    const existing = await this.runtime.binding(
      project.organizationId,
      project.id,
      runtimeId,
    );
    if (existing) return existing;
    if (!project.canonicalRemoteUrl) {
      throw new Error(
        "This project only exists on another runtime. Add a Git remote before using it elsewhere.",
      );
    }
    const destination = join(
      this.repositoriesRoot,
      workspaceSegment(project.organizationId),
      `${safeSegment(project.name, "project")}-${project.id.slice(0, 8)}`,
    );
    await mkdir(join(destination, ".."), { recursive: true, mode: 0o700 });
    await git(
      ["clone", "--", project.canonicalRemoteUrl, destination],
      undefined,
      120_000,
    );
    return this.bindRepository(
      project,
      await repositoryRoot(destination),
      "materialized",
    );
  }
}
