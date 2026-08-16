import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import type { ProjectPrincipal } from "../types.js";
import type { CredentialBroker } from "./credential-broker.js";
import type { ProjectServiceAuthorization } from "./service-base.js";
import type { ProjectPersistence } from "./store.js";
import { redactSecrets } from "./credential-broker.js";
import { git, safeSegment, workspaceSegment } from "./repository-git.js";
import { ProjectServiceBase } from "./service-base.js";

export interface CreateProjectCheckoutInput {
  organizationId: string;
  projectId: string;
  agentId: string;
  sessionId?: string;
  baseRef?: string;
  branch?: string;
}

export interface PublishCheckoutInput {
  targetBranch?: string;
  correlationId?: string;
  allowDefaultBranch?: boolean;
}

/** Chief-owned isolated checkouts: creation, status, commit, release, publish. */
export class ProjectCheckoutService extends ProjectServiceBase {
  private readonly checkoutsRoot: string;

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
    this.checkoutsRoot = join(this.root, "checkouts");
  }

  async createCheckout(
    input: CreateProjectCheckoutInput,
    principal: ProjectPrincipal,
  ) {
    const project = await this.requireProject(
      input.organizationId,
      input.projectId,
    );
    await this.authorize(
      input.organizationId,
      input.projectId,
      principal,
      "checkout",
    );
    try {
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
        ["rev-parse", "--verify", "--end-of-options", `${baseRef}^{commit}`],
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
      const checkout = await this.runtime.saveCheckout({
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
      await this.recordOperation("checkout", {
        organizationId: input.organizationId,
        projectId: project.id,
        principal,
        agentId: input.agentId,
        checkoutId: checkout.id,
        branch,
        result: "success",
      });
      return checkout;
    } catch (error) {
      await this.recordOperation("checkout", {
        organizationId: input.organizationId,
        projectId: project.id,
        principal,
        agentId: input.agentId,
        result: "failed",
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async checkoutStatus(
    organizationId: string,
    checkoutId: string,
    principal: ProjectPrincipal,
  ) {
    const checkout = await this.requireCheckout(organizationId, checkoutId);
    this.requireOwnership(checkout.agentId, principal);
    await this.authorize(organizationId, checkout.projectId, principal, "view");
    const status = await git(["status", "--short", "--branch"], checkout.path);
    const diff = await git(["diff", "--stat", "HEAD"], checkout.path);
    return { checkout, status, diff };
  }

  async commit(
    organizationId: string,
    checkoutId: string,
    message: string,
    principal: ProjectPrincipal,
  ) {
    const checkout = await this.requireCheckout(organizationId, checkoutId);
    this.requireOwnership(checkout.agentId, principal);
    await this.authorize(
      organizationId,
      checkout.projectId,
      principal,
      "commit",
      checkout.branch,
    );
    try {
      if (!(await git(["status", "--porcelain"], checkout.path))) {
        throw new Error("There are no changes to commit.");
      }
      const subject = message.trim().replace(/\s+/g, " ").slice(0, 240);
      if (!subject) throw new Error("A commit message is required.");
      await git(["add", "--all"], checkout.path);
      const agentName = `${safeSegment(principal.id, "Agent")} via Chief`;
      const agentEmail = `${safeSegment(principal.id, "agent")}@agents.chief.local`;
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
      await this.recordOperation("commit", {
        organizationId,
        projectId: checkout.projectId,
        principal,
        agentId: checkout.agentId,
        checkoutId: checkout.id,
        branch: checkout.branch,
        commitHash: hash,
        result: "success",
      });
      return { checkout, hash, shortHash: hash.slice(0, 7), subject };
    } catch (error) {
      await this.recordOperation("commit", {
        organizationId,
        projectId: checkout.projectId,
        principal,
        agentId: checkout.agentId,
        checkoutId: checkout.id,
        branch: checkout.branch,
        result: "failed",
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async releaseCheckout(
    organizationId: string,
    checkoutId: string,
    principal: ProjectPrincipal,
  ) {
    const checkout = await this.requireCheckout(organizationId, checkoutId);
    this.requireOwnership(checkout.agentId, principal);
    await this.authorize(
      organizationId,
      checkout.projectId,
      principal,
      "commit",
    );
    try {
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
      const saved = await this.runtime.saveCheckout(checkout);
      await this.recordOperation("release", {
        organizationId,
        projectId: checkout.projectId,
        principal,
        agentId: checkout.agentId,
        checkoutId: checkout.id,
        branch: checkout.branch,
        result: "success",
      });
      return saved;
    } catch (error) {
      await this.recordOperation("release", {
        organizationId,
        projectId: checkout.projectId,
        principal,
        agentId: checkout.agentId,
        checkoutId: checkout.id,
        branch: checkout.branch,
        result: "failed",
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  private requireOwnership(agentId: string, principal: ProjectPrincipal) {
    if (principal.type === "agent" && principal.id !== agentId) {
      throw new Error("This checkout belongs to another agent.");
    }
  }

  /**
   * Pushes one owned branch through an explicit refspec. Direct pushes to the
   * default branch stay disabled unless an operator explicitly authorizes one
   * constrained operation.
   */
  async publish(
    organizationId: string,
    checkoutId: string,
    principal: ProjectPrincipal,
    input: PublishCheckoutInput = {},
  ) {
    const checkout = await this.requireCheckout(organizationId, checkoutId);
    this.requireOwnership(checkout.agentId, principal);
    const project = await this.requireProject(
      organizationId,
      checkout.projectId,
    );
    const targetBranch = input.targetBranch?.trim() ?? checkout.branch;
    await this.authorize(
      organizationId,
      project.id,
      principal,
      "publish",
      targetBranch,
    );
    if (
      targetBranch === project.defaultBranch &&
      !(input.allowDefaultBranch && principal.type === "user")
    ) {
      throw new Error(
        "Publishing directly to the default branch is disabled unless an operator explicitly authorizes it.",
      );
    }
    if (!project.canonicalRemoteUrl) {
      throw new Error("This project has no Git remote to publish to.");
    }
    try {
      const binding = await this.ensureBinding(project);
      const head = await git(["rev-parse", "HEAD"], checkout.path);
      const refspec = `refs/heads/${checkout.branch}:refs/heads/${targetBranch}`;
      const broker = this.credentialBroker;
      if (broker) {
        const credential = await broker.request({
          organizationId,
          projectId: project.id,
          remoteUrl: project.canonicalRemoteUrl,
          operation: "push",
        });
        try {
          const authorization = `AUTHORIZATION: basic ${Buffer.from(
            `${credential.username}:${credential.password}`,
          ).toString("base64")}`;
          await git(
            [
              "-c",
              `http.extraheader=${authorization}`,
              "push",
              project.canonicalRemoteUrl,
              refspec,
            ],
            checkout.path,
            120_000,
          );
        } catch (error) {
          throw new Error(
            redactSecrets(
              error instanceof Error ? error.message : String(error),
              [credential.password, credential.username],
            ),
          );
        }
      } else {
        await git(
          ["push", project.canonicalRemoteUrl, refspec],
          checkout.path,
          120_000,
        );
      }
      await this.recordOperation("publish", {
        organizationId,
        projectId: project.id,
        principal,
        agentId: checkout.agentId,
        checkoutId: checkout.id,
        branch: targetBranch,
        commitHash: head,
        correlationId: input.correlationId,
        result: "success",
      });
      void binding;
      return {
        checkoutId: checkout.id,
        branch: targetBranch,
        head,
        correlationId: input.correlationId,
      };
    } catch (error) {
      await this.recordOperation("publish", {
        organizationId,
        projectId: project.id,
        principal,
        agentId: checkout.agentId,
        checkoutId: checkout.id,
        branch: targetBranch,
        correlationId: input.correlationId,
        result: "failed",
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /** Destroys uncommitted checkout state only after explicit confirmation. */
  async discard(
    organizationId: string,
    checkoutId: string,
    principal: ProjectPrincipal,
    input: { confirmed: boolean },
  ) {
    if (!input.confirmed) {
      throw new Error("Discard requires explicit confirmation.");
    }
    const checkout = await this.requireCheckout(organizationId, checkoutId);
    this.requireOwnership(checkout.agentId, principal);
    await this.authorize(
      organizationId,
      checkout.projectId,
      principal,
      "commit",
    );
    try {
      await git(["reset", "--hard", "HEAD"], checkout.path);
      await git(["clean", "-fd"], checkout.path);
      await this.recordOperation("discard", {
        organizationId,
        projectId: checkout.projectId,
        principal,
        agentId: checkout.agentId,
        checkoutId: checkout.id,
        branch: checkout.branch,
        result: "success",
      });
      return { checkoutId: checkout.id, discarded: true };
    } catch (error) {
      await this.recordOperation("discard", {
        organizationId,
        projectId: checkout.projectId,
        principal,
        agentId: checkout.agentId,
        checkoutId: checkout.id,
        branch: checkout.branch,
        result: "failed",
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
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
