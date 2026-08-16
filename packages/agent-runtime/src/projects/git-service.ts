import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";

import type {
  ProjectRecord,
  ProjectRepositoryBindingRecord,
} from "../types.js";
import type {
  ProjectCatalogStore,
  ProjectPersistence,
  ProjectRuntimeStore,
} from "./store.js";
import { resolveProjectProvider } from "./providers.js";
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

export interface CreateProjectCheckoutInput {
  organizationId: string;
  projectId: string;
  agentId: string;
  sessionId?: string;
  baseRef?: string;
  branch?: string;
}

/** Real Git operations behind project IDs and Chief-owned checkout paths. */
export class ProjectGitService {
  private readonly root: string;
  private readonly repositoriesRoot: string;
  private readonly checkoutsRoot: string;
  private runtimeIdPromise?: Promise<string>;
  private readonly catalog: ProjectCatalogStore;
  private readonly runtime: ProjectRuntimeStore;

  constructor(
    persistence: ProjectPersistence,
    root = join(homedir(), ".chief"),
  ) {
    this.catalog = persistence.catalog;
    this.runtime = persistence.runtime;
    this.root = root;
    this.repositoriesRoot = join(root, "repositories");
    this.checkoutsRoot = join(root, "checkouts");
  }

  private runtimeId() {
    this.runtimeIdPromise ??= (async () => {
      const path = join(this.root, "runtime-id");
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

  async attach(
    organizationId: string,
    path: string,
    input?: { name?: string; description?: string },
  ) {
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
    return project;
  }

  async clone(
    organizationId: string,
    remoteUrl: string,
    input?: { name?: string; description?: string },
  ) {
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
    return project;
  }

  async list(organizationId: string) {
    const projects = await this.catalog.list(organizationId);
    const runtimeId = await this.runtimeId();
    return Promise.all(
      projects.map(async (project) => {
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

  async inspect(organizationId: string, projectId: string) {
    const project = await this.requireProject(organizationId, projectId);
    const runtimeId = await this.runtimeId();
    const binding = await this.ensureBinding(project);
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
    requestedRef?: string,
    requestedPath?: string,
  ) {
    const project = await this.requireProject(organizationId, projectId);
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
    requestedRef: string | undefined,
    commit: string,
  ) {
    const project = await this.requireProject(organizationId, projectId);
    const binding = await this.ensureBinding(project);
    const ref = requestedRef?.trim();
    return inspectRepositoryCommit(
      project.id,
      binding.repositoryPath,
      ref?.length ? ref : project.defaultBranch,
      commit,
    );
  }

  async createCheckout(input: CreateProjectCheckoutInput) {
    const project = await this.requireProject(
      input.organizationId,
      input.projectId,
    );
    const binding = await this.ensureBinding(project);
    const runtimeId = await this.runtimeId();
    const id = randomUUID();
    const agentId = safeSegment(input.agentId, "agent");
    const branch = input.branch?.trim()
      ? input.branch.trim()
      : `chief/${agentId}/${id.slice(0, 8)}`;
    if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/.test(branch)) {
      throw new Error("Use a valid Git branch name.");
    }
    try {
      await git(["check-ref-format", "--branch", branch]);
    } catch {
      throw new Error("Use a valid Git branch name.");
    }
    const baseRef = input.baseRef?.trim()
      ? input.baseRef.trim()
      : project.defaultBranch;
    await git(
      ["rev-parse", "--verify", `${baseRef}^{commit}`],
      binding.repositoryPath,
    );
    const path = join(
      this.checkoutsRoot,
      workspaceSegment(input.organizationId),
      project.id,
      id,
    );
    await mkdir(join(path, ".."), { recursive: true, mode: 0o700 });
    await git(
      ["worktree", "add", "-b", branch, "--", path, baseRef],
      binding.repositoryPath,
      60_000,
    );
    const now = Date.now();
    return this.runtime.saveCheckout({
      id,
      organizationId: input.organizationId,
      projectId: project.id,
      runtimeId,
      agentId: input.agentId,
      agentIdentity: `${agentId}@chief`,
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
      strategy: "worktree",
      path,
      branch,
      baseRef,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
  }

  async checkoutStatus(organizationId: string, checkoutId: string) {
    const checkout = await this.requireCheckout(organizationId, checkoutId);
    const status = await git(["status", "--short", "--branch"], checkout.path);
    const diff = await git(["diff", "--stat", "HEAD"], checkout.path);
    return { checkout, status, diff };
  }

  async commit(
    organizationId: string,
    checkoutId: string,
    message: string,
    agentId: string,
  ) {
    const checkout = await this.requireCheckout(organizationId, checkoutId);
    if (checkout.agentId !== agentId) {
      throw new Error("This checkout belongs to another agent.");
    }
    if (!(await git(["status", "--porcelain"], checkout.path))) {
      throw new Error("There are no changes to commit.");
    }
    const subject = message.trim().replace(/\s+/g, " ").slice(0, 240);
    if (!subject) throw new Error("A commit message is required.");
    await git(["add", "--all"], checkout.path);
    const agentName = `${safeSegment(agentId, "Agent")} via Chief`;
    const agentEmail = `${safeSegment(agentId, "agent")}@agents.chief.local`;
    await git(
      [
        "-c",
        `user.name=${agentName}`,
        "-c",
        `user.email=${agentEmail}`,
        "commit",
        "-m",
        subject,
        "-m",
        `Chief-Agent: ${checkout.agentIdentity}`,
      ],
      checkout.path,
      120_000,
    );
    const hash = await git(["rev-parse", "HEAD"], checkout.path);
    checkout.updatedAt = Date.now();
    await this.runtime.saveCheckout(checkout);
    return { checkout, hash, shortHash: hash.slice(0, 7), subject };
  }

  async releaseCheckout(
    organizationId: string,
    checkoutId: string,
    agentId: string,
  ) {
    const checkout = await this.requireCheckout(organizationId, checkoutId);
    if (checkout.agentId !== agentId) {
      throw new Error("This checkout belongs to another agent.");
    }
    if (await git(["status", "--porcelain"], checkout.path)) {
      throw new Error(
        "Commit or discard the checkout changes before releasing it.",
      );
    }
    const project = await this.requireProject(
      organizationId,
      checkout.projectId,
    );
    const binding = await this.ensureBinding(project);
    await git(
      ["worktree", "remove", "--", checkout.path],
      binding.repositoryPath,
    );
    await git(["worktree", "prune"], binding.repositoryPath);
    checkout.status = "released";
    checkout.updatedAt = Date.now();
    return this.runtime.saveCheckout(checkout);
  }

  private async requireProject(organizationId: string, projectId: string) {
    const project = await this.catalog.get(organizationId, projectId);
    if (!project) throw new Error("Project does not belong to this workspace.");
    return project;
  }

  private async bindRepository(
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

  private async ensureBinding(project: ProjectRecord) {
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

  private async requireCheckout(organizationId: string, checkoutId: string) {
    const checkout = await this.runtime.checkout(organizationId, checkoutId);
    if (
      checkout?.status !== "active" ||
      checkout.runtimeId !== (await this.runtimeId())
    ) {
      throw new Error("Active checkout does not belong to this workspace.");
    }
    return checkout;
  }
}
