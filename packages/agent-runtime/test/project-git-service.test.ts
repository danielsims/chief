import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { LocalStore } from "../src/local-store.js";
import { ProjectGitService } from "../src/projects/git-service.js";
import { resolveProjectProvider } from "../src/projects/providers.js";
import { assertRemoteUrl } from "../src/projects/repository-git.js";

process.env.CHIEF_DATABASE_ENCRYPTION_KEY =
  "chief-project-git-service-test-encryption-key";

void test("hosted forges resolve through provider adapters while arbitrary Git stays supported", () => {
  assert.deepEqual(resolveProjectProvider("git@github.com:openai/codex.git"), {
    id: "github",
    label: "GitHub",
    canonicalRemoteUrl: "git@github.com:openai/codex.git",
    repositoryWebUrl: "https://github.com/openai/codex",
  });
  assert.equal(
    resolveProjectProvider("ssh://git@git.example.com/team/repo.git").id,
    "generic-git",
  );
  assert.equal(
    resolveProjectProvider("ssh://git@gitlab.com/team/repo.git")
      .canonicalRemoteUrl,
    "ssh://git@gitlab.com/team/repo.git",
  );
  assert.equal(resolveProjectProvider(undefined).id, "local");
  assert.throws(
    () => assertRemoteUrl("https://token@github.com/openai/codex.git"),
    /Do not put a credential/,
  );
});

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
  const service = new ProjectGitService(
    { catalog: projectStore, runtime: projectStore },
    join(directory, "chief-home"),
  );
  return { directory, repository, service, store };
}

void test("agents commit through isolated worktrees without changing the attached checkout", async () => {
  const { directory, repository, service, store } = fixture();
  try {
    const project = await service.attach("workspace-a", repository);
    const rootHead = git(repository, "rev-parse", "HEAD");
    const checkout = await service.createCheckout({
      organizationId: "workspace-a",
      projectId: project.id,
      agentId: "engineer",
      sessionId: "session-1",
    });

    assert.equal(checkout.strategy, "worktree");
    assert.equal(checkout.agentIdentity, "engineer@chief");
    assert.match(checkout.branch, /^chief\/engineer\/[a-f0-9]{8}$/);
    assert.equal(git(repository, "rev-parse", "HEAD"), rootHead);

    writeFileSync(
      join(checkout.path, "feature.ts"),
      "export const ready = true;\n",
    );
    const committed = await service.commit(
      "workspace-a",
      checkout.id,
      "Add project support",
      "engineer",
    );
    assert.equal(committed.subject, "Add project support");
    assert.equal(git(repository, "rev-parse", "HEAD"), rootHead);
    assert.equal(
      git(checkout.path, "show", "-s", "--format=%ae", "HEAD"),
      "engineer@agents.chief.local",
    );
    assert.match(
      git(checkout.path, "show", "-s", "--format=%B", "HEAD"),
      /Chief-Agent: engineer@chief/,
    );

    const snapshot = await service.inspect("workspace-a", project.id);
    assert.equal(snapshot.available, true);
    assert.equal(snapshot.clean, true);
    assert.equal(snapshot.checkouts.length, 1);
    await service.releaseCheckout("workspace-a", checkout.id, "engineer");
    assert.equal(existsSync(checkout.path), false);
    assert.equal(
      (await store.projectStore().checkout("workspace-a", checkout.id))?.status,
      "released",
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

void test("project browsing returns a committed tree, README, contributors, files, and app icon", async () => {
  const { directory, repository, service } = fixture();
  try {
    const project = await service.attach("workspace-a", repository);
    const [snapshot] = await service.list("workspace-a");
    assert.ok(snapshot);
    assert.match(snapshot.iconDataUrl ?? "", /^data:image\/png;base64,/);

    writeFileSync(
      join(repository, "README.md"),
      '# Real repository\n\n<a href="https://example.com"><img src="public/favicon.png" alt="Project icon" /></a>\n\nUpdated.\n',
    );
    git(repository, "add", "README.md");
    git(
      repository,
      "-c",
      "user.name=Daniel",
      "-c",
      "user.email=daniel@example.com",
      "commit",
      "-m",
      "Update documentation",
    );

    const root = await service.browse("workspace-a", project.id, "main");
    assert.equal(root.kind, "tree");
    assert.match(root.readme?.content ?? "", /^# Real repository/);
    assert.match(
      root.readme?.content ?? "",
      /\[!\[Project icon\]\(https:\/\/chief\.local\/readme-assets\/0\)/,
    );
    assert.doesNotMatch(root.readme?.content ?? "", /<img/);
    assert.match(
      root.readme?.imageSources?.["https://chief.local/readme-assets/0"] ?? "",
      /^data:image\/png;base64,/,
    );
    assert.deepEqual(
      root.entries.map((entry) => [entry.name, entry.type]),
      [
        ["public", "directory"],
        ["src", "directory"],
        ["README.md", "file"],
      ],
    );
    assert.equal(
      root.entries.every((entry) => entry.lastCommit),
      true,
    );
    assert.equal(root.contributors[0]?.name, "Daniel");
    assert.deepEqual(
      root.commits.map((commit) => commit.subject),
      ["Update documentation", "Initial commit"],
    );
    const latest = root.commits[0];
    assert.ok(latest);
    const detail = await service.inspectCommit(
      "workspace-a",
      project.id,
      "main",
      latest.hash,
    );
    assert.equal(detail.commit.subject, "Update documentation");
    assert.equal(detail.filesChanged, 1);
    assert.equal(detail.additions, 2);
    assert.equal(detail.deletions, 0);
    assert.match(detail.patch, /diff --git a\/README\.md b\/README\.md/);
    assert.equal(detail.truncated, false);

    const source = await service.browse(
      "workspace-a",
      project.id,
      "main",
      "src/index.ts",
    );
    assert.equal(source.kind, "file");
    assert.equal(source.file?.content, "export const ready = true;\n");
    assert.deepEqual(
      source.commits.map((commit) => commit.subject),
      ["Initial commit"],
    );
    assert.deepEqual(source.commits[0]?.parentHashes, []);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

void test("a shared project materializes independently on another runtime", async () => {
  const { directory, repository, service, store } = fixture();
  try {
    const remote = join(directory, "remote.git");
    execFileSync("git", ["init", "--bare", remote]);
    git(repository, "remote", "add", "origin", `file://${remote}`);
    git(repository, "push", "-u", "origin", "main");

    const project = await service.attach("workspace-a", repository);
    const local = await service.inspect("workspace-a", project.id);
    assert.equal(local.available, true);
    assert.equal(local.portable, true);
    assert.equal(local.binding?.kind, "attached");

    const projectStore = store.projectStore();
    const deployed = new ProjectGitService(
      { catalog: projectStore, runtime: projectStore },
      join(directory, "deployed-runtime"),
    );
    const before = await deployed.list("workspace-a");
    const [beforeProject] = before;
    assert.ok(beforeProject);
    assert.equal(beforeProject.available, false);
    assert.equal(beforeProject.portable, true);
    assert.equal(beforeProject.binding, undefined);

    const materialized = await deployed.inspect("workspace-a", project.id);
    assert.equal(materialized.available, true);
    assert.ok(materialized.binding);
    assert.ok(local.binding);
    assert.equal(materialized.binding.kind, "materialized");
    assert.notEqual(
      materialized.binding.repositoryPath,
      local.binding.repositoryPath,
    );
    assert.notEqual(materialized.binding.runtimeId, local.binding.runtimeId);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

void test("project and checkout identifiers never cross workspace boundaries", async () => {
  const { directory, repository, service } = fixture();
  try {
    const project = await service.attach("workspace-a", repository);
    await assert.rejects(
      service.inspect("workspace-b", project.id),
      /does not belong to this workspace/,
    );
    await assert.rejects(
      service.browse("workspace-b", project.id, "main"),
      /does not belong to this workspace/,
    );
    const checkout = await service.createCheckout({
      organizationId: "workspace-a",
      projectId: project.id,
      agentId: "engineer",
    });
    await assert.rejects(
      service.checkoutStatus("workspace-b", checkout.id),
      /does not belong to this workspace/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
