import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { ProjectPrincipal } from "../src/project-types.js";
import type { CredentialBroker } from "../src/projects/credential-broker.js";
import type { ProjectPersistence } from "../src/projects/store.js";
import { LocalStore } from "../src/local-store.js";
import { ProjectAuthorizationService } from "../src/projects/authorization.js";
import { ProjectGitService } from "../src/projects/git-service.js";

process.env.CHIEF_DATABASE_ENCRYPTION_KEY =
  "chief-project-compare-publish-test-encryption-key";

const operator: ProjectPrincipal = { type: "user", id: "operator" };
const engineer: ProjectPrincipal = { type: "agent", id: "engineer" };
const intruder: ProjectPrincipal = { type: "agent", id: "intruder" };

function git(path: string, ...args: string[]) {
  return execFileSync("git", args, {
    cwd: path,
    encoding: "utf8",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" },
  }).trim();
}

function fixture(broker?: CredentialBroker) {
  const directory = mkdtempSync(join(tmpdir(), "chief-publish-"));
  const repository = join(directory, "source");
  execFileSync("git", ["init", "--initial-branch=main", repository]);
  writeFileSync(join(repository, "README.md"), "# publish repo\n");
  writeFileSync(join(repository, "notes.txt"), "line one\nline two\n");
  git(repository, "add", "README.md", "notes.txt");
  git(
    repository,
    "-c",
    "user.name=Workspace",
    "-c",
    "user.email=owner@example.com",
    "commit",
    "-m",
    "Initial commit",
  );
  const remote = join(directory, "remote.git");
  execFileSync("git", ["init", "--bare", remote]);
  git(repository, "remote", "add", "origin", `file://${remote}`);
  git(repository, "push", "-u", "origin", "main");

  const store = new LocalStore(join(directory, "chief.sqlite"));
  const projectStore = store.projectStore();
  const service = new ProjectGitService(projectStore, {
    root: join(directory, "chief-home"),
    authorization: new ProjectAuthorizationService(projectStore.grants, () => [
      operator,
    ]),
    ...(broker ? { broker } : undefined),
  });
  return { directory, repository, remote, service, store, projectStore };
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
    ...(constraintJson ? { constraintJson } : undefined),
    createdAt: now,
    updatedAt: now,
  });
}

async function engineerCheckout(service: ProjectGitService, projectId: string) {
  return service.checkouts.createCheckout(
    {
      organizationId: "workspace-a",
      projectId,
      agentId: "engineer",
      branch: "chief/engineer/feature",
    },
    engineer,
  );
}

void test("comparing branches returns bounded commits, counts, and a diff", async () => {
  const { directory, repository, service } = fixture();
  try {
    const project = await service.attach("workspace-a", repository, operator);
    writeFileSync(join(repository, "notes.txt"), "line one\nline two edited\n");
    git(
      repository,
      "-c",
      "user.name=Workspace",
      "-c",
      "user.email=owner@example.com",
      "commit",
      "-am",
      "Update notes",
    );
    const comparison = await service.compare(
      "workspace-a",
      project.id,
      operator,
      "main~1",
      "main",
    );
    assert.equal(comparison.baseRef, "main~1");
    assert.equal(comparison.ahead, 1);
    assert.equal(comparison.behind, 0);
    assert.equal(comparison.filesChanged, 1);
    assert.equal(comparison.additions, 1);
    assert.equal(comparison.deletions, 1);
    assert.equal(comparison.commits[0]?.subject, "Update notes");
    assert.match(comparison.patch, /diff --git a\/notes\.txt b\/notes\.txt/);
    assert.equal(comparison.truncated, false);
    assert.equal(comparison.mergeConflict, false);
    await assert.rejects(
      service.compare("workspace-a", project.id, operator, "main", "main"),
      /two different branches/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

void test("comparing divergent branches detects a merge conflict", async () => {
  const { directory, repository, service } = fixture();
  try {
    const project = await service.attach("workspace-a", repository, operator);
    execFileSync("git", ["checkout", "-b", "feature-a"], { cwd: repository });
    writeFileSync(join(repository, "notes.txt"), "line one\nfeature A\n");
    git(
      repository,
      "-c",
      "user.name=Workspace",
      "-c",
      "user.email=owner@example.com",
      "commit",
      "-am",
      "Feature A change",
    );
    execFileSync("git", ["checkout", "main"], { cwd: repository });
    execFileSync("git", ["checkout", "-b", "feature-b"], { cwd: repository });
    writeFileSync(join(repository, "notes.txt"), "line one\nfeature B\n");
    git(
      repository,
      "-c",
      "user.name=Workspace",
      "-c",
      "user.email=owner@example.com",
      "commit",
      "-am",
      "Feature B change",
    );
    const comparison = await service.compare(
      "workspace-a",
      project.id,
      operator,
      "feature-a",
      "feature-b",
    );
    assert.equal(comparison.mergeConflict, true);
    assert.ok(comparison.mergeBase);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

void test("an authorized agent publishes its branch to the remote", async () => {
  const { directory, repository, remote, service, projectStore } = fixture();
  try {
    const project = await service.attach("workspace-a", repository, operator);
    for (const capability of [
      "view",
      "checkout",
      "commit",
      "publish",
    ] as const) {
      await grant(
        projectStore,
        "workspace-a",
        project.id,
        engineer,
        capability,
      );
    }
    const checkout = await engineerCheckout(service, project.id);
    writeFileSync(join(checkout.path, "feature.ts"), "export const x = 1;\n");
    await service.checkouts.commit(
      "workspace-a",
      checkout.id,
      "Add feature",
      engineer,
    );
    const head = git(checkout.path, "rev-parse", "HEAD");
    const published = await service.checkouts.publish(
      "workspace-a",
      checkout.id,
      engineer,
    );
    assert.equal(published.branch, "chief/engineer/feature");
    assert.equal(published.head, head);
    assert.equal(
      git(
        repository,
        "ls-remote",
        `file://${remote}`,
        "refs/heads/chief/engineer/feature",
      ).includes(head),
      true,
    );
    const operations = await projectStore.operations.listOperations(
      "workspace-a",
      project.id,
    );
    assert.ok(
      operations.some(
        (operation) =>
          operation.operation === "publish" && operation.result === "success",
      ),
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

void test("default-branch publish stays denied unless an operator authorizes it", async () => {
  const { directory, repository, service, projectStore } = fixture();
  try {
    const project = await service.attach("workspace-a", repository, operator);
    for (const capability of [
      "view",
      "checkout",
      "commit",
      "publish",
    ] as const) {
      await grant(
        projectStore,
        "workspace-a",
        project.id,
        engineer,
        capability,
      );
    }
    const checkout = await engineerCheckout(service, project.id);
    writeFileSync(join(checkout.path, "feature.ts"), "export const x = 1;\n");
    await service.checkouts.commit(
      "workspace-a",
      checkout.id,
      "Add feature",
      engineer,
    );
    await assert.rejects(
      service.checkouts.publish("workspace-a", checkout.id, engineer, {
        targetBranch: "main",
      }),
      /default branch is disabled/,
    );
    const published = await service.checkouts.publish(
      "workspace-a",
      checkout.id,
      operator,
      { targetBranch: "main", allowDefaultBranch: true },
    );
    assert.equal(published.branch, "main");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

void test("publish enforces branch constraints and checkout ownership", async () => {
  const { directory, repository, service, projectStore } = fixture();
  try {
    const project = await service.attach("workspace-a", repository, operator);
    for (const capability of [
      "view",
      "checkout",
      "commit",
      "publish",
    ] as const) {
      await grant(
        projectStore,
        "workspace-a",
        project.id,
        engineer,
        capability,
        {
          branches: ["chief/*"],
        },
      );
    }
    const checkout = await engineerCheckout(service, project.id);
    writeFileSync(join(checkout.path, "feature.ts"), "export const x = 1;\n");
    await service.checkouts.commit(
      "workspace-a",
      checkout.id,
      "Add feature",
      engineer,
    );
    await assert.rejects(
      service.checkouts.publish("workspace-a", checkout.id, engineer, {
        targetBranch: "release",
      }),
      /does not cover the branch/,
    );
    await assert.rejects(
      service.checkouts.publish("workspace-a", checkout.id, intruder),
      /belongs to another agent/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

void test("publish redacts credentials from surfaced errors", async () => {
  const leaked = "ghp_LEAKED_TOKEN";
  const broker: CredentialBroker = {
    id: "test-broker",
    request: () =>
      Promise.resolve({ username: "x-access-token", password: leaked }),
  };
  const { directory, repository, service, projectStore } = fixture(broker);
  try {
    const project = await service.attach("workspace-a", repository, operator);
    for (const capability of [
      "view",
      "checkout",
      "commit",
      "publish",
    ] as const) {
      await grant(
        projectStore,
        "workspace-a",
        project.id,
        engineer,
        capability,
      );
    }
    const checkout = await engineerCheckout(service, project.id);
    writeFileSync(join(checkout.path, "feature.ts"), "export const x = 1;\n");
    await service.checkouts.commit(
      "workspace-a",
      checkout.id,
      "Add feature",
      engineer,
    );
    const published = await service.checkouts.publish(
      "workspace-a",
      checkout.id,
      engineer,
    );
    assert.equal(published.branch, "chief/engineer/feature");
    const operations = await projectStore.operations.listOperations(
      "workspace-a",
      project.id,
    );
    for (const operation of operations) {
      assert.ok(
        operation.message?.includes(leaked) !== true,
        "credentials never appear in audit records",
      );
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

void test("discard destroys uncommitted changes only after confirmation", async () => {
  const { directory, repository, service, projectStore } = fixture();
  try {
    const project = await service.attach("workspace-a", repository, operator);
    for (const capability of ["view", "checkout", "commit"] as const) {
      await grant(
        projectStore,
        "workspace-a",
        project.id,
        engineer,
        capability,
      );
    }
    const checkout = await engineerCheckout(service, project.id);
    writeFileSync(join(checkout.path, "uncommitted.txt"), "lost work\n");
    writeFileSync(join(checkout.path, "untracked.txt"), "gone\n");
    await assert.rejects(
      service.checkouts.discard("workspace-a", checkout.id, engineer, {
        confirmed: false,
      }),
      /explicit confirmation/,
    );
    await service.checkouts.discard("workspace-a", checkout.id, engineer, {
      confirmed: true,
    });
    const status = git(checkout.path, "status", "--porcelain");
    assert.equal(status, "");
    assert.equal(
      (
        await projectStore.operations.listOperations("workspace-a", project.id)
      ).some(
        (operation) =>
          operation.operation === "discard" && operation.result === "success",
      ),
      true,
    );
    await assert.rejects(
      service.checkouts.discard("workspace-a", checkout.id, intruder, {
        confirmed: true,
      }),
      /belongs to another agent/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

void test("publish and discard never cross workspace boundaries", async () => {
  const { directory, repository, service, projectStore } = fixture();
  try {
    const project = await service.attach("workspace-a", repository, operator);
    for (const capability of [
      "view",
      "checkout",
      "commit",
      "publish",
    ] as const) {
      await grant(
        projectStore,
        "workspace-a",
        project.id,
        engineer,
        capability,
      );
    }
    const checkout = await engineerCheckout(service, project.id);
    writeFileSync(join(checkout.path, "feature.ts"), "export const x = 1;\n");
    await service.checkouts.commit(
      "workspace-a",
      checkout.id,
      "Add feature",
      engineer,
    );
    await assert.rejects(
      service.checkouts.publish("workspace-b", checkout.id, engineer),
      /does not belong to this workspace/,
    );
    await assert.rejects(
      service.checkouts.discard("workspace-b", checkout.id, engineer, {
        confirmed: true,
      }),
      /does not belong to this workspace/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
