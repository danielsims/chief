import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { relayProjectCreateSchema } from "../../relay-contracts/src/projects.js";
import { queryLocalProject } from "../src/projects/local-project-query.js";
import {
  bindLocalProject,
  listLocalProjectBindings,
  prepareLocalProject,
  prepareLocalProjectCheckout,
} from "../src/projects/local-projects.js";
import { assertRemoteUrl, git } from "../src/projects/repository-git.js";

void test("local private repository connection keeps paths local and isolates each agent's worktree", async () => {
  const root = await mkdtemp(join(tmpdir(), "chief-local-project-"));
  const source = join(root, "source");
  try {
    execFileSync("git", ["init", "--initial-branch=main", source]);
    await writeFile(join(source, "README.md"), "Original\n");
    await git(["add", "README.md"], source);
    await git(
      [
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@example.com",
        "commit",
        "-m",
        "Initial",
      ],
      source,
    );
    await git(
      ["remote", "add", "origin", "git@github.com:private/company.git"],
      source,
    );
    const prepared = await prepareLocalProject(
      { workspaceId: "workspace-a", source: "attach", path: source },
      root,
    );
    assert.equal(
      prepared.project.canonicalRemoteUrl,
      "ssh://git@github.com/private/company.git",
    );
    assert.equal(JSON.stringify(prepared).includes(source), false);
    await bindLocalProject(
      {
        workspaceId: "workspace-a",
        connectionId: prepared.connectionId,
        projectId: "project-a",
      },
      root,
    );
    assert.equal(
      (await listLocalProjectBindings("workspace-a", root)).length,
      1,
    );
    assert.deepEqual(await listLocalProjectBindings("workspace-b", root), []);
    const checkout = await prepareLocalProjectCheckout(
      {
        workspaceId: "workspace-a",
        projectId: "project-a",
        agentId: "engineer",
      },
      root,
    );
    assert.notEqual(checkout.directory, source);
    const listed = await queryLocalProject(
      { workspaceId: "workspace-a", operation: "snapshots" },
      root,
    );
    assert.ok("snapshots" in listed && listed.snapshots[0]?.available);
    const browsed = await queryLocalProject(
      {
        workspaceId: "workspace-a",
        operation: "browse",
        projectId: "project-a",
        ref: "main",
        path: "README.md",
      },
      root,
    );
    assert.ok(
      "browser" in browsed && browsed.browser.file?.content === "Original\n",
    );
    await assert.rejects(
      queryLocalProject(
        {
          workspaceId: "workspace-b",
          operation: "browse",
          projectId: "project-a",
          ref: "main",
        },
        root,
      ),
      /Connect this repository/,
    );
    await assert.rejects(
      queryLocalProject(
        {
          workspaceId: "workspace-a",
          operation: "browse",
          projectId: "project-a",
          ref: "main",
          path: "../outside",
        },
        root,
      ),
      /path inside the project/,
    );

    await writeFile(join(checkout.directory, "README.md"), "Agent change\n");
    assert.equal(
      await readFile(join(source, "README.md"), "utf8"),
      "Original\n",
    );
    assert.equal(
      (
        await prepareLocalProjectCheckout(
          {
            workspaceId: "workspace-a",
            projectId: "project-a",
            agentId: "engineer",
          },
          root,
        )
      ).directory,
      checkout.directory,
    );
    await assert.rejects(
      prepareLocalProjectCheckout(
        {
          workspaceId: "workspace-b",
          projectId: "project-a",
          agentId: "engineer",
        },
        root,
      ),
      /Connect this project/,
    );
    const other = await prepareLocalProjectCheckout(
      {
        workspaceId: "workspace-a",
        projectId: "project-a",
        agentId: "reviewer",
      },
      root,
    );
    assert.notEqual(other.directory, checkout.directory);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test("repository boundaries reject credentials and executable URL schemes", () => {
  for (const remote of [
    "https://token@github.com/private/repo.git",
    "ssh://git:secret@github.com/private/repo.git",
    "https://github.com/private/repo.git?token=secret",
    "https://github.com/private/repo.git#secret",
    "file:///etc/passwd",
    "https://github.com/private/\nrepo.git",
  ]) {
    assert.throws(() => assertRemoteUrl(remote));
    assert.equal(
      relayProjectCreateSchema.safeParse({
        name: "Repo",
        repositoryKind: "cloned",
        providerId: "github",
        canonicalRemoteUrl: remote,
        defaultBranch: "main",
      }).success,
      false,
    );
  }
});

void test("trusted Git commands do not execute repository filesystem monitors", async () => {
  const root = await mkdtemp(join(tmpdir(), "chief-git-monitor-"));
  const source = join(root, "source");
  const marker = join(root, "executed");
  const monitor = join(root, "monitor.sh");
  try {
    execFileSync("git", ["init", "--initial-branch=main", source]);
    await writeFile(monitor, `#!/bin/sh\ntouch '${marker}'\n`, { mode: 0o700 });
    execFileSync("git", ["config", "core.fsmonitor", monitor], { cwd: source });
    execFileSync("git", ["status", "--short"], {
      cwd: source,
      stdio: "ignore",
    });
    await readFile(marker);
    await rm(marker);
    await git(["status", "--short"], source);
    await assert.rejects(readFile(marker), { code: "ENOENT" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
