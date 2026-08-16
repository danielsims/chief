import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { basename, join } from "node:path";

import type { ProjectPrincipal, ProjectRecord } from "../types.js";
import type { CredentialBroker } from "./credential-broker.js";
import type { ProjectServiceAuthorization } from "./service-base.js";
import type { ProjectPersistence } from "./store.js";
import { ProjectCheckoutService } from "./checkouts.js";
import { compareRepositoryBranches } from "./compare.js";
import {
  projectProviderCapabilities,
  resolveProjectProvider,
} from "./providers.js";
import {
  browseRepository,
  inspectRepositoryCommit,
} from "./repository-browser.js";
import {
  assertRemoteUrl,
  cleanRemoteUrl,
  git,
  optionalGit,
  repositoryDefaultBranch,
  repositoryRoot,
  repositorySnapshot,
  safeSegment,
  workspaceSegment,
} from "./repository-git.js";
import { ProjectServiceBase } from "./service-base.js";

/** Workspace project catalog and repository browsing behind one service. */
export class ProjectGitService extends ProjectServiceBase {
  readonly checkouts: ProjectCheckoutService;

  constructor(
    persistence: ProjectPersistence,
    options: {
      root?: string;
      authorization?: ProjectServiceAuthorization;
      broker?: CredentialBroker;
    } = {},
  ) {
    super(persistence, {
      ...(options.root ? { root: options.root } : {}),
      ...(options.authorization
        ? { authorization: options.authorization }
        : {}),
      ...(options.broker ? { broker: options.broker } : {}),
    });
    this.checkouts = new ProjectCheckoutService(persistence, options);
  }

  async attach(
    organizationId: string,
    path: string,
    principal: ProjectPrincipal,
    input?: { name?: string; description?: string },
  ) {
    await this.authorizeCreation(organizationId, principal);
    try {
      const root = await repositoryRoot(path);
      const now = Date.now();
      const remote = cleanRemoteUrl(
        await optionalGit(["remote", "get-url", "origin"], root),
      );
      const provider = resolveProjectProvider(remote);
      const existing = provider.canonicalRemoteUrl
        ? await this.catalog.findByRemote(
            organizationId,
            provider.canonicalRemoteUrl,
          )
        : undefined;
      const project =
        existing ??
        (await this.catalog.save({
          id: randomUUID(),
          organizationId,
          name: input?.name?.trim() ? input.name.trim() : basename(root),
          ...(input?.description?.trim()
            ? { description: input.description.trim() }
            : {}),
          repositoryKind: "attached",
          providerId: provider.id,
          ...(provider.canonicalRemoteUrl
            ? { canonicalRemoteUrl: provider.canonicalRemoteUrl }
            : {}),
          ...(provider.repositoryWebUrl
            ? { repositoryWebUrl: provider.repositoryWebUrl }
            : {}),
          defaultBranch: await repositoryDefaultBranch(root),
          createdAt: now,
          updatedAt: now,
        }));
      await this.bindRepository(project, root, "attached");
      await this.recordOperation("attach", {
        organizationId,
        projectId: project.id,
        principal,
        result: "success",
      });
      return project;
    } catch (error) {
      await this.recordOperation("attach", {
        organizationId,
        principal,
        result: "failed",
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async clone(
    organizationId: string,
    remoteUrl: string,
    principal: ProjectPrincipal,
    input?: { name?: string; description?: string },
  ) {
    await this.authorizeCreation(organizationId, principal);
    try {
      const validatedRemote = assertRemoteUrl(remoteUrl);
      const id = randomUUID();
      const remoteName = validatedRemote
        .replace(/\/$/, "")
        .split(/[/:]/)
        .at(-1)
        ?.replace(/\.git$/i, "");
      const name = input?.name?.trim()
        ? input.name.trim()
        : (remoteName ?? "Project");
      const destination = join(
        this.repositoriesRoot,
        workspaceSegment(organizationId),
        `${safeSegment(name, "project")}-${id.slice(0, 8)}`,
      );
      await mkdir(join(destination, ".."), { recursive: true, mode: 0o700 });
      await git(
        ["clone", "--", validatedRemote, destination],
        undefined,
        120_000,
      );
      const root = await repositoryRoot(destination);
      const now = Date.now();
      const provider = resolveProjectProvider(cleanRemoteUrl(validatedRemote));
      const existing = provider.canonicalRemoteUrl
        ? await this.catalog.findByRemote(
            organizationId,
            provider.canonicalRemoteUrl,
          )
        : undefined;
      const project =
        existing ??
        (await this.catalog.save({
          id,
          organizationId,
          name,
          ...(input?.description?.trim()
            ? { description: input.description.trim() }
            : {}),
          repositoryKind: "cloned",
          providerId: provider.id,
          ...(provider.canonicalRemoteUrl
            ? { canonicalRemoteUrl: provider.canonicalRemoteUrl }
            : {}),
          ...(provider.repositoryWebUrl
            ? { repositoryWebUrl: provider.repositoryWebUrl }
            : {}),
          defaultBranch: await repositoryDefaultBranch(root),
          createdAt: now,
          updatedAt: now,
        }));
      await this.bindRepository(project, root, "materialized");
      await this.recordOperation("clone", {
        organizationId,
        projectId: project.id,
        principal,
        result: "success",
      });
      return project;
    } catch (error) {
      await this.recordOperation("clone", {
        organizationId,
        principal,
        result: "failed",
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async list(organizationId: string, principal: ProjectPrincipal) {
    const projects = await this.catalog.list(organizationId);
    const runtimeId = await this.runtimeId();
    const visible: ProjectRecord[] = [];
    for (const project of projects) {
      try {
        await this.authorize(organizationId, project.id, principal, "view");
        visible.push(project);
      } catch {
        // A principal only sees the projects it is authorized to view.
      }
    }
    return Promise.all(
      visible.map(async (project) => {
        const [binding, checkouts] = await Promise.all([
          this.runtime.binding(organizationId, project.id, runtimeId),
          this.runtime.listCheckouts(
            organizationId,
            project.id,
            true,
            runtimeId,
          ),
        ]);
        return repositorySnapshot(project, binding, checkouts);
      }),
    );
  }

  async inspect(
    organizationId: string,
    projectId: string,
    principal: ProjectPrincipal,
  ) {
    const project = await this.requireProject(organizationId, projectId);
    await this.authorize(organizationId, projectId, principal, "view");
    const runtimeId = await this.runtimeId();
    const binding = await this.ensureBinding(project);
    await this.recordOperation("inspect", {
      organizationId,
      projectId,
      principal,
      result: "success",
    });
    return repositorySnapshot(
      project,
      binding,
      await this.runtime.listCheckouts(
        organizationId,
        project.id,
        true,
        runtimeId,
      ),
    );
  }

  async browse(
    organizationId: string,
    projectId: string,
    principal: ProjectPrincipal,
    requestedRef?: string,
    requestedPath?: string,
  ) {
    const project = await this.requireProject(organizationId, projectId);
    await this.authorize(organizationId, projectId, principal, "view");
    const binding = await this.ensureBinding(project);
    const ref = requestedRef?.trim();
    return browseRepository(
      project.id,
      binding.repositoryPath,
      ref?.length ? ref : project.defaultBranch,
      requestedPath,
    );
  }

  async inspectCommit(
    organizationId: string,
    projectId: string,
    principal: ProjectPrincipal,
    requestedRef: string | undefined,
    commit: string,
  ) {
    const project = await this.requireProject(organizationId, projectId);
    await this.authorize(organizationId, projectId, principal, "view");
    const binding = await this.ensureBinding(project);
    const ref = requestedRef?.trim();
    return inspectRepositoryCommit(
      project.id,
      binding.repositoryPath,
      ref?.length ? ref : project.defaultBranch,
      commit,
    );
  }

  async compare(
    organizationId: string,
    projectId: string,
    principal: ProjectPrincipal,
    baseRef: string,
    compareRef: string,
  ) {
    const project = await this.requireProject(organizationId, projectId);
    await this.authorize(organizationId, projectId, principal, "view");
    const binding = await this.ensureBinding(project);
    return compareRepositoryBranches(
      project.id,
      binding.repositoryPath,
      baseRef,
      compareRef,
    );
  }

  /** Whether this project's provider can host pull requests today. */
  async pullRequestCapability(
    organizationId: string,
    projectId: string,
    principal: ProjectPrincipal,
  ) {
    const project = await this.requireProject(organizationId, projectId);
    await this.authorize(organizationId, projectId, principal, "view");
    const capabilities = projectProviderCapabilities(project.providerId);
    if (capabilities.pullRequests) {
      return { supported: true as const };
    }
    return {
      supported: false as const,
      reason: `Pull requests are not available for ${project.providerId} repositories in Chief yet.`,
    };
  }
}
