import type {
  GitFile,
  GitObject,
  GitRef,
  GitRepository,
} from "@chief/agent-runtime/git-objects";
import { buildGitRepository } from "@chief/agent-runtime/git-objects";

import { HttpError } from "./http";

export const GIT_HEAD_REF = "refs/heads/main";
// A Durable Object SQLite row (key + value) cannot exceed 2 MB. Leave headroom
// for the row's other columns and the object header.
const MAX_GIT_OBJECT_BYTES = 1_800_000;

/** Normalises the repo slug used to address a workspace Git repository. */
export function gitRepoSlug(repo: string) {
  return repo
    .replace(/\.git$/u, "")
    .trim()
    .toLowerCase();
}

/**
 * A repo slug that is safe to use as a single path segment (for example
 * /workspace/<repo>) and inside agent instructions: no separators, no
 * leading dot, no whitespace or control characters.
 */
export function isSafeGitRepoSlug(repo: string) {
  return /^[a-z0-9][a-z0-9._-]{0,127}$/u.test(repo);
}

export function readGitRefs(
  storage: DurableObjectStorage,
  repo: string,
): GitRef[] {
  return [
    ...storage.sql.exec<{ ref: string; sha: string }>(
      "SELECT ref, sha FROM workspace_git_refs WHERE repo = ? ORDER BY ref",
      repo,
    ),
  ].map((row) => ({ ref: row.ref, sha: row.sha }));
}

export function readGitHead(
  storage: DurableObjectStorage,
  repo: string,
): string | undefined {
  const rows = [
    ...storage.sql.exec<{ sha: string }>(
      "SELECT sha FROM workspace_git_refs WHERE repo = ? AND ref = ?",
      repo,
      GIT_HEAD_REF,
    ),
  ];
  return rows[0]?.sha;
}

export function readGitObjects(
  storage: DurableObjectStorage,
  repo: string,
): GitObject[] {
  return [
    ...storage.sql.exec<{
      sha: string;
      type: GitObject["type"];
      payload: ArrayBuffer;
    }>(
      "SELECT sha, type, payload FROM workspace_git_objects WHERE repo = ?",
      repo,
    ),
  ].map((row) => ({
    sha: row.sha,
    type: row.type,
    payload: new Uint8Array(row.payload),
  }));
}

export function readGitRepository(
  storage: DurableObjectStorage,
  repo: string,
): GitRepository | undefined {
  const head = readGitHead(storage, repo);
  if (!head) return undefined;
  return {
    branch: "main",
    commitSha: head,
    objects: readGitObjects(storage, repo),
  };
}

/**
 * Persists a commit's objects and advances the ref with a compare-and-swap, so
 * two concurrent publishes can never silently drop one another's work. Objects
 * are immutable and inserted idempotently.
 *
 * `expectedHead` is the ref value the commit was built on (`null` when the
 * repository had no head yet). If the ref has moved since, the write fails
 * closed with a conflict and the caller must re-read and retry.
 */
export function writeGitCommit(
  storage: DurableObjectStorage,
  repo: string,
  repository: GitRepository,
  message: string,
  authorName: string,
  ref: string = GIT_HEAD_REF,
  expectedHead: string | null = null,
) {
  const now = new Date().toISOString();
  storage.transactionSync(() => {
    const currentHead = readGitHead(storage, repo) ?? null;
    if (currentHead !== expectedHead) {
      throw new HttpError(
        409,
        "git_ref_conflict",
        "The repository changed while this commit was being prepared.",
      );
    }
    for (const object of repository.objects) {
      if (object.payload.byteLength > MAX_GIT_OBJECT_BYTES) {
        throw new HttpError(
          413,
          "git_object_too_large",
          "A file in this repository is too large for the workspace Git host.",
        );
      }
      storage.sql.exec(
        "INSERT OR IGNORE INTO workspace_git_objects (repo, sha, type, size, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        repo,
        object.sha,
        object.type,
        object.payload.byteLength,
        toArrayBuffer(object.payload),
        now,
      );
    }
    storage.sql.exec(
      "INSERT INTO workspace_git_refs (repo, ref, sha, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(repo, ref) DO UPDATE SET sha = excluded.sha, updated_at = excluded.updated_at",
      repo,
      ref,
      repository.commitSha,
      now,
    );
    storage.sql.exec(
      "INSERT OR REPLACE INTO workspace_git_commits (repo, sha, message, author_name, created_at) VALUES (?, ?, ?, ?, ?)",
      repo,
      repository.commitSha,
      message,
      authorName,
      now,
    );
  });
}

export interface PublishGitTreeInput {
  repo: string;
  files: readonly GitFile[];
  message?: string;
  authorName?: string;
  authorEmail?: string;
}

/**
 * Builds a commit from a file tree on top of the repository's current head and
 * advances the ref. This is the constrained "publish" path: the caller sends
 * files, never a packfile, so the relay never parses untrusted Git wire data.
 */
export async function publishGitTree(
  storage: DurableObjectStorage,
  input: PublishGitTreeInput,
): Promise<{ commitSha: string; parentSha?: string }> {
  const repo = gitRepoSlug(input.repo);
  const parentSha = readGitHead(storage, repo);
  const repository = await buildGitRepository(input.files, {
    ...(parentSha ? { parentSha } : undefined),
    ...(input.message ? { message: input.message } : undefined),
    ...(input.authorName ? { authorName: input.authorName } : undefined),
    ...(input.authorEmail ? { authorEmail: input.authorEmail } : undefined),
    timestamp: Math.floor(Date.now() / 1000),
  });
  writeGitCommit(
    storage,
    repo,
    repository,
    input.message?.trim() ?? "Publish from agent",
    input.authorName?.trim() ?? "Agent",
    GIT_HEAD_REF,
    parentSha ?? null,
  );
  return {
    commitSha: repository.commitSha,
    ...(parentSha ? { parentSha } : undefined),
  };
}

function toArrayBuffer(bytes: Uint8Array) {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}
