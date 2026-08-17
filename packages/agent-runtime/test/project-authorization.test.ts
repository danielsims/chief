import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { ProjectPrincipal } from "../src/project-types.js";
import type { ProjectPersistence } from "../src/projects/store.js";
import { LocalStore } from "../src/local-store.js";
import { ProjectAdministrationService } from "../src/projects/admin.js";
import {
  ProjectAuthorizationError,
  ProjectAuthorizationService,
} from "../src/projects/authorization.js";
import { ProjectCheckoutService } from "../src/projects/checkouts.js";
import { ProjectGitService } from "../src/projects/git-service.js";

process.env.CHIEF_DATABASE_ENCRYPTION_KEY =
  "chief-project-authorization-test-encryption-key";

const operator: ProjectPrincipal = { type: "user", id: "operator" };
const foreign: ProjectPrincipal = { type: "user", id: "someone-else" };
const engineer: ProjectPrincipal = { type: "agent", id: "engineer" };
const reviewer: ProjectPrincipal = { type: "agent", id: "reviewer" };

function git(path: string, ...args: string[]) {
  return execFileSync("git", args, {
    cwd: path,
    encoding: "utf8",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" },
  }).trim();
}

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "chief-authz-"));
  const repository = join(directory, "source");
  execFileSync("git", ["init", "--initial-branch=main", repository]);
  writeFileSync(join(repository, "README.md"), "# authz repo\n");
  git(repository, "add", "README.md");
  git(
    repository,
    "-c",
    "user.name=Daniel",
    "-c",
    "user.email=daniel@example.com",
    "commit",
    "-m",
    "Initial commit",
  );
  const store = new LocalStore(join(directory, "chief.sqlite"));
  const projectStore = store.projectStore();
  const authorization = new ProjectAuthorizationService(
    projectStore.grants,
    () => [operator],
  );
  const service = new ProjectGitService(projectStore, {
    root: join(directory, "chief-home"),
    authorization,
  });
  const checkouts = new ProjectCheckoutService(projectStore, {
    root: join(directory, "chief-home"),
    authorization,
  });
  const administration = new ProjectAdministrationService(projectStore, {
    root: join(directory, "chief-home"),
    authorization,
  });
  return {
    directory,
    repository,
    service,
    checkouts,
    administration,
    store,
    projectStore,
  };
}

async function grant(
  projectStore: ProjectPersistence,
  organizationId: string,
  projectId: string,
  principal: ProjectPrincipal,
  capability:
    "view" | "checkout" | "commit" | "publish" | "review" | "administer",
  constraintJson?: { branches?: string[]; expiresAt?: number },
) {
  const now = Date.now();
  await projectStore.grants.saveGrant({
    id: randomUUID(),
    organizationId,
    projectId,
    principalType: principal.type,
    principalId: principal.id,
    capability,
    ...(constraintJson ? { constraintJson } : {}),
    createdAt: now,
    updatedAt: now,
  });
}

void test("an agent without grants cannot inspect, checkout, or commit", async () => {
  const { directory, repository, service, checkouts, projectStore } = fixture();
  try {
    const project = await service.attach("workspace-a", repository, operator);
    await assert.rejects(
      service.inspect("workspace-a", project.id, engineer),
      ProjectAuthorizationError,
    );
    await assert.rejects(
      service.browse("workspace-a", project.id, engineer, "main"),
      ProjectAuthorizationError,
    );
    await assert.rejects(
      checkouts.createCheckout(
        {
          organizationId: "workspace-a",
          projectId: project.id,
          agentId: "engineer",
        },
        engineer,
      ),
      ProjectAuthorizationError,
    );
    const denied = (
      await projectStore.operations.listOperations("workspace-a", project.id)
    ).find((operation) => operation.result === "denied");
    assert.ok(denied, "denied attempts are audited");
    assert.equal(denied.operation, "denied");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

void test("grants are capability-scoped and hierarchy-aware", async () => {
  const {
    directory,
    repository,
    service,
    checkouts,
    administration,
    projectStore,
  } = fixture();
  try {
    const project = await service.attach("workspace-a", repository, operator);
    await grant(projectStore, "workspace-a", project.id, engineer, "view");
    await grant(projectStore, "workspace-a", project.id, reviewer, "publish");

    const snapshot = await service.inspect("workspace-a", project.id, engineer);
    assert.equal(snapshot.available, true);
    await assert.rejects(
      checkouts.createCheckout(
        {
          organizationId: "workspace-a",
          projectId: project.id,
          agentId: "engineer",
        },
        engineer,
      ),
      ProjectAuthorizationError,
    );

    const checkout = await checkouts.createCheckout(
      {
        organizationId: "workspace-a",
        projectId: project.id,
        agentId: "reviewer",
      },
      reviewer,
    );
    writeFileSync(join(checkout.path, "feature.ts"), "export const x = 1;\n");
    await checkouts.commit("workspace-a", checkout.id, "Add feature", reviewer);
    assert.equal(
      git(checkout.path, "show", "-s", "--format=%an", "HEAD"),
      "reviewer via Chief",
    );
    await assert.rejects(
      administration.grant(
        "workspace-a",
        { projectId: project.id, principal: reviewer, capability: "view" },
        reviewer,
      ),
      ProjectAuthorizationError,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

void test("an administer grant covers every capability", async () => {
  const {
    directory,
    repository,
    service,
    checkouts,
    administration,
    projectStore,
  } = fixture();
  try {
    const project = await service.attach("workspace-a", repository, operator);
    await grant(
      projectStore,
      "workspace-a",
      project.id,
      engineer,
      "administer",
    );
    const checkout = await checkouts.createCheckout(
      {
        organizationId: "workspace-a",
        projectId: project.id,
        agentId: "engineer",
      },
      engineer,
    );
    writeFileSync(join(checkout.path, "x.ts"), "export const x = 1;\n");
    const committed = await checkouts.commit(
      "workspace-a",
      checkout.id,
      "Add x",
      engineer,
    );
    assert.equal(committed.subject, "Add x");
    const grants = await administration.listGrants(
      "workspace-a",
      project.id,
      engineer,
    );
    assert.equal(grants.length, 1);
    await checkouts.releaseCheckout("workspace-a", checkout.id, engineer);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

void test("branch constraints deny commits outside the allowed branches", async () => {
  const { directory, repository, service, checkouts, projectStore } = fixture();
  try {
    const project = await service.attach("workspace-a", repository, operator);
    await grant(projectStore, "workspace-a", project.id, engineer, "commit", {
      branches: ["chief/*"],
    });
    await grant(projectStore, "workspace-a", project.id, engineer, "checkout", {
      branches: ["chief/*"],
    });
    const checkout = await checkouts.createCheckout(
      {
        organizationId: "workspace-a",
        projectId: project.id,
        agentId: "engineer",
      },
      engineer,
    );
    writeFileSync(
      join(checkout.path, "feature.ts"),
      "export const ready = true;\n",
    );
    const committed = await checkouts.commit(
      "workspace-a",
      checkout.id,
      "Add feature",
      engineer,
    );
    assert.match(committed.hash, /^[0-9a-f]{40}$/);

    await grant(projectStore, "workspace-a", project.id, reviewer, "commit", {
      branches: ["main"],
    });
    await grant(projectStore, "workspace-a", project.id, reviewer, "checkout");
    const restricted = await checkouts.createCheckout(
      {
        organizationId: "workspace-a",
        projectId: project.id,
        agentId: "reviewer",
        branch: "feature/reviewer-change",
      },
      reviewer,
    );
    writeFileSync(join(restricted.path, "other.ts"), "export const y = 2;\n");
    await assert.rejects(
      checkouts.commit(
        "workspace-a",
        restricted.id,
        "Rejected by constraint",
        reviewer,
      ),
      /does not cover the branch/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

void test("expired grants are denied and foreign principals stay blocked", async () => {
  const { directory, repository, service, checkouts, projectStore } = fixture();
  try {
    const project = await service.attach("workspace-a", repository, operator);
    await grant(projectStore, "workspace-a", project.id, engineer, "view", {
      expiresAt: Date.now() - 1_000,
    });
    await assert.rejects(
      service.browse("workspace-a", project.id, engineer, "main"),
      /expired/,
    );
    await assert.rejects(
      service.inspect("workspace-a", project.id, foreign),
      ProjectAuthorizationError,
    );
    await assert.rejects(
      checkouts.createCheckout(
        {
          organizationId: "workspace-a",
          projectId: project.id,
          agentId: "intruder",
        },
        foreign,
      ),
      ProjectAuthorizationError,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

void test("agents can discover projects but need a view grant to inspect them", async () => {
  const { directory, repository, service, projectStore } = fixture();
  try {
    const project = await service.attach("workspace-a", repository, operator);

    const beforeGrant = await service.list("workspace-a", engineer);
    assert.equal(beforeGrant.length, 1);
    assert.equal(beforeGrant[0]?.project.id, project.id);
    assert.equal(
      beforeGrant[0].available,
      false,
      "repository state stays hidden without view access",
    );
    assert.match(beforeGrant[0].error ?? "", /do not have view access/);
    await assert.rejects(
      service.browse("workspace-a", project.id, engineer, "main"),
      ProjectAuthorizationError,
    );

    await grant(projectStore, "workspace-a", project.id, engineer, "view");
    const afterGrant = await service.list("workspace-a", engineer);
    assert.equal(afterGrant[0]?.available, true);
    const snapshot = await service.inspect("workspace-a", project.id, engineer);
    assert.equal(snapshot.available, true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

void test("only operators can create projects", async () => {
  const { directory, repository, service, administration } = fixture();
  try {
    await assert.rejects(
      service.attach("workspace-a", repository, engineer),
      ProjectAuthorizationError,
    );
    await assert.rejects(
      service.attach("workspace-a", repository, foreign),
      ProjectAuthorizationError,
    );
    const project = await service.attach("workspace-a", repository, operator);
    assert.ok(project.id);
    await assert.rejects(
      administration.operations("workspace-a", engineer),
      ProjectAuthorizationError,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

void test("agent access requests require operator approval before taking effect", async () => {
  const {
    directory,
    repository,
    service,
    checkouts,
    administration,
    projectStore,
  } = fixture();
  try {
    const project = await service.attach("workspace-a", repository, operator);
    const request = await administration.requestProjectAccess(
      "workspace-a",
      project.id,
      "engineer",
      ["view", "checkout", "commit"],
    );
    assert.equal(request.status, "pending");
    assert.deepEqual(request.capabilities, ["view", "checkout", "commit"]);
    assert.equal(
      (
        await administration.requestProjectAccess(
          "workspace-a",
          project.id,
          "engineer",
          ["commit", "view"],
        )
      ).id,
      request.id,
      "retries reuse the pending request instead of creating duplicate prompts",
    );
    const pending = await administration.pendingAccessRequests(
      "workspace-a",
      operator,
    );
    assert.equal(pending.length, 1);
    assert.equal(pending[0]?.id, request.id);
    await assert.rejects(
      administration.approveProjectAccess("workspace-a", request.id, foreign),
      ProjectAuthorizationError,
    );
    await assert.rejects(
      administration.approveProjectAccess("workspace-b", request.id, operator),
      /does not belong to the workspace/,
    );
    await assert.rejects(
      checkouts.createCheckout(
        {
          organizationId: "workspace-a",
          projectId: project.id,
          agentId: "engineer",
        },
        engineer,
      ),
      ProjectAuthorizationError,
      "the agent stays blocked until approval",
    );
    const approved = await administration.approveProjectAccess(
      "workspace-a",
      request.id,
      operator,
    );
    assert.equal(approved.status, "approved");
    const grants = await projectStore.grants.grants(
      "workspace-a",
      project.id,
      engineer,
    );
    assert.deepEqual(
      grants.map((grant) => grant.capability),
      ["commit"],
      "one highest-scope grant covers the approved capability batch",
    );
    const checkout = await checkouts.createCheckout(
      {
        organizationId: "workspace-a",
        projectId: project.id,
        agentId: "engineer",
      },
      engineer,
    );
    assert.match(checkout.branch, /^chief\/engineer\//);
    assert.equal(
      (await administration.pendingAccessRequests("workspace-a", operator))
        .length,
      0,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

void test("denied access requests never create a grant", async () => {
  const { directory, repository, service, checkouts, administration } =
    fixture();
  try {
    const project = await service.attach("workspace-a", repository, operator);
    const request = await administration.requestProjectAccess(
      "workspace-a",
      project.id,
      "engineer",
      ["view", "checkout", "commit"],
    );
    await administration.denyProjectAccess("workspace-a", request.id, operator);
    await assert.rejects(
      checkouts.createCheckout(
        {
          organizationId: "workspace-a",
          projectId: project.id,
          agentId: "engineer",
        },
        engineer,
      ),
      ProjectAuthorizationError,
    );
    await assert.rejects(
      administration.approveProjectAccess("workspace-a", request.id, operator),
      /no longer pending/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
