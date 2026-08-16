import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { ProjectPrincipal } from "../src/project-types.js";
import { LocalStore } from "../src/local-store.js";
import { ProjectAuthorizationService } from "../src/projects/authorization.js";
import { ProjectGitService } from "../src/projects/git-service.js";
import { projectIconDataUrl } from "../src/projects/project-icon.js";

process.env.CHIEF_DATABASE_ENCRYPTION_KEY =
  "chief-project-repository-hardening-test-encryption-key";

const operator: ProjectPrincipal = { type: "user", id: "operator" };

function git(path: string, ...args: string[]) {
  return execFileSync("git", args, {
    cwd: path,
    encoding: "utf8",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" },
  }).trim();
}

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "chief-projects-"));
  const repository = join(directory, "source");
  execFileSync("git", ["init", "--initial-branch=main", repository]);
  mkdirSync(join(repository, "public"), { recursive: true });
  mkdirSync(join(repository, "src"), { recursive: true });
  writeFileSync(
    join(repository, "README.md"),
    '# Real repository\n\n<a href="https://example.com"><img src="public/favicon.png" alt="Project icon" /></a>\n',
  );
  writeFileSync(
    join(repository, "src", "index.ts"),
    "export const ready = true;\n",
  );
  writeFileSync(
    join(repository, "public", "favicon.png"),
    Buffer.from("89504e470d0a1a0a", "hex"),
  );
  git(repository, "add", "README.md", "src/index.ts", "public/favicon.png");
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
  const service = new ProjectGitService(projectStore, {
    root: join(directory, "chief-home"),
    authorization: new ProjectAuthorizationService(projectStore.grants, () => [
      operator,
    ]),
  });
  return { directory, repository, service };
}

void test("browsing rejects traversal, malformed refs, and malformed commits", async () => {
  const { directory, repository, service } = fixture();
  try {
    const project = await service.attach("workspace-a", repository, operator);
    for (const traversal of [
      "../secret",
      "src/../../outside",
      "/etc/passwd",
      "src/\0nul",
      "src/..",
    ]) {
      await assert.rejects(
        service.browse("workspace-a", project.id, operator, "main", traversal),
        /path inside the project repository/,
      );
    }
    await assert.rejects(
      service.browse("workspace-a", project.id, operator, "main\n--output"),
      /valid Git ref/,
    );
    await assert.rejects(
      service.browse("workspace-a", project.id, operator, "--all"),
      /valid Git ref|ambiguous|rev-parse|unknown revision/i,
    );
    await assert.rejects(
      service.inspectCommit(
        "workspace-a",
        project.id,
        operator,
        "main",
        "not-a-hash",
      ),
      /valid commit hash/,
    );
    await assert.rejects(
      service.inspectCommit(
        "workspace-a",
        project.id,
        operator,
        "main",
        "../..",
      ),
      /valid commit hash/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

void test("checkout and icon behavior tolerate spaces, Unicode, submodules, and symlinks", async () => {
  const { directory, repository, service } = fixture();
  try {
    const project = await service.attach("workspace-a", repository, operator);
    const rootHash = git(repository, "rev-parse", "HEAD");
    execFileSync(
      "git",
      [
        "update-index",
        "--add",
        "--cacheinfo",
        "160000",
        rootHash,
        "lib/vendor",
      ],
      { cwd: repository, encoding: "utf8" },
    );
    git(
      repository,
      "-c",
      "user.name=Daniel",
      "-c",
      "user.email=daniel@example.com",
      "commit",
      "-m",
      "Add submodule gitlink",
    );
    const root = await service.browse(
      "workspace-a",
      project.id,
      operator,
      "main",
    );
    const lib = root.entries.find((entry) => entry.name === "lib");
    assert.equal(lib?.type, "directory");
    const libTree = await service.browse(
      "workspace-a",
      project.id,
      operator,
      "main",
      "lib",
    );
    const vendor = libTree.entries.find((entry) => entry.name === "vendor");
    assert.equal(vendor?.type, "submodule");
    await assert.rejects(
      service.browse("workspace-a", project.id, operator, "main", "lib/vendor"),
      /cannot be browsed/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

void test("icon discovery never follows a symlink outside the repository", async () => {
  const directory = mkdtempSync(join(tmpdir(), "chief-icon-"));
  try {
    const repository = join(directory, "repo with spaces");
    execFileSync("git", ["init", "--initial-branch=main", repository]);
    mkdirSync(join(repository, "public"), { recursive: true });
    writeFileSync(join(repository, "README.md"), "# icon repo\n");
    symlinkSync(
      join(directory, "secret.png"),
      join(repository, "public", "favicon.png"),
    );
    writeFileSync(join(directory, "secret.png"), "outside-repository-secret");
    git(repository, "add", "README.md", "public/favicon.png");
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
    const icon = await projectIconDataUrl(repository);
    assert.equal(icon, undefined);
    const store = new LocalStore(join(directory, "chief.sqlite"));
    const projectStore = store.projectStore();
    const service = new ProjectGitService(projectStore, {
      root: join(directory, "chief-home"),
      authorization: new ProjectAuthorizationService(
        projectStore.grants,
        () => [operator],
      ),
    });
    await service.attach("workspace-a", repository, operator);
    const [snapshot] = await service.list("workspace-a", operator);
    assert.equal(snapshot?.iconDataUrl, undefined);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
