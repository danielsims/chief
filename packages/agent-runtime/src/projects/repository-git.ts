import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { realpath } from "node:fs/promises";
import { promisify } from "node:util";

import type {
  ProjectCheckoutRecord,
  ProjectCommitSummary,
  ProjectRecord,
  ProjectRepositoryBindingRecord,
  ProjectRepositorySnapshot,
} from "../types.js";
import { projectIconDataUrl } from "./project-icon.js";

const executeFile = promisify(execFile);
const GIT_TIMEOUT_MS = 30_000;
const GIT_OUTPUT_LIMIT = 4 * 1024 * 1024;

export function safeSegment(value: string, fallback: string) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64) || fallback
  );
}

export function workspaceSegment(organizationId: string) {
  return createHash("sha256").update(organizationId).digest("hex").slice(0, 16);
}

export function cleanRemoteUrl(value: string | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "ssh:") parsed.username = "";
    parsed.password = "";
    return parsed.toString();
  } catch {
    return trimmed;
  }
}

export function assertRemoteUrl(value: string) {
  const trimmed = value.trim();
  if (/^[\w.-]+@[\w.-]+:[^\s]+$/.test(trimmed)) return trimmed;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("Use an HTTPS or SSH Git remote URL.");
  }
  if (!new Set(["https:", "ssh:"]).has(parsed.protocol)) {
    throw new Error("Only HTTPS and SSH Git remotes can be cloned.");
  }
  if (parsed.password) {
    throw new Error("Do not put a credential in the repository URL.");
  }
  if (parsed.protocol === "https:" && parsed.username) {
    throw new Error("Do not put a credential in the repository URL.");
  }
  return trimmed;
}

function gitError(error: unknown) {
  if (!error || typeof error !== "object") return String(error);
  const record = error as {
    stderr?: string;
    stdout?: string;
    message?: string;
  };
  return (
    [record.stderr?.trim(), record.stdout?.trim(), record.message].find(
      (value) => Boolean(value),
    ) ?? "Git could not complete the operation."
  );
}

export async function git(
  args: string[],
  cwd?: string,
  timeout = GIT_TIMEOUT_MS,
) {
  try {
    const result = await executeFile("git", args, {
      ...(cwd ? { cwd } : {}),
      encoding: "utf8",
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" },
      maxBuffer: GIT_OUTPUT_LIMIT,
      timeout,
    });
    return result.stdout.trim();
  } catch (error) {
    throw new Error(gitError(error));
  }
}

export async function gitBuffer(
  args: string[],
  cwd: string,
  timeout = GIT_TIMEOUT_MS,
) {
  return new Promise<Buffer>((resolve, reject) => {
    execFile(
      "git",
      args,
      {
        cwd,
        encoding: "buffer",
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" },
        maxBuffer: GIT_OUTPUT_LIMIT,
        timeout,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(
            new Error(
              gitError({
                message: error.message,
                stderr: stderr.toString("utf8"),
              }),
            ),
          );
          return;
        }
        resolve(stdout);
      },
    );
  });
}

export async function optionalGit(args: string[], cwd: string) {
  try {
    return await git(args, cwd);
  } catch {
    return undefined;
  }
}

export async function repositoryRoot(path: string) {
  const resolved = await realpath(path.trim());
  const root = await git(["rev-parse", "--show-toplevel"], resolved);
  return realpath(root);
}

export async function repositoryDefaultBranch(path: string) {
  const remoteHead = await optionalGit(
    ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"],
    path,
  );
  if (remoteHead?.startsWith("origin/")) return remoteHead.slice(7);
  return (
    (await optionalGit(["symbolic-ref", "--quiet", "--short", "HEAD"], path)) ??
    "main"
  );
}

async function recentCommits(path: string): Promise<ProjectCommitSummary[]> {
  const output = await optionalGit(
    [
      "log",
      "-20",
      "--date-order",
      "--format=%H%x1f%h%x1f%P%x1f%s%x1f%an%x1f%ae%x1f%at%x1e",
    ],
    path,
  );
  if (!output) return [];
  return output
    .split("\x1e")
    .map((record) => record.trim())
    .filter(Boolean)
    .flatMap((record) => {
      const [
        hash,
        shortHash,
        parents,
        subject,
        authorName,
        authorEmail,
        authoredAt,
      ] = record.split("\x1f");
      if (!hash || !shortHash || !subject || !authorName || !authorEmail) {
        return [];
      }
      return [
        {
          hash,
          shortHash,
          parentHashes: parents?.split(" ").filter(Boolean) ?? [],
          subject,
          authorName,
          authorEmail,
          authoredAt: Number(authoredAt ?? 0) * 1_000,
        },
      ];
    });
}

export async function repositorySnapshot(
  project: ProjectRecord,
  binding: ProjectRepositoryBindingRecord | undefined,
  checkouts: ProjectCheckoutRecord[],
): Promise<ProjectRepositorySnapshot> {
  const portable = Boolean(project.canonicalRemoteUrl);
  if (!binding) {
    return {
      project,
      portable,
      available: false,
      branches: [],
      commits: [],
      checkouts,
      error: portable
        ? "This project is shared, but it has not been materialized on this runtime yet."
        : "This local-only project is not available on this runtime.",
    };
  }
  try {
    const [status, iconDataUrl] = await Promise.all([
      git(["status", "--porcelain=v2", "--branch"], binding.repositoryPath),
      projectIconDataUrl(binding.repositoryPath),
    ]);
    const branch = /^# branch\.head (.+)$/m.exec(status)?.[1];
    const head = /^# branch\.oid (.+)$/m.exec(status)?.[1];
    const divergence = /^# branch\.ab \+(\d+) -(\d+)$/m.exec(status);
    const changedFiles = status
      .split("\n")
      .filter((line) => line && !line.startsWith("#")).length;
    const branchOutput = await git(
      ["for-each-ref", "--format=%(refname:short)", "refs/heads"],
      binding.repositoryPath,
    );
    return {
      project,
      binding,
      portable,
      available: true,
      ...(branch && branch !== "(detached)" ? { branch } : {}),
      ...(head && head !== "(initial)" ? { head } : {}),
      clean: changedFiles === 0,
      ahead: Number(divergence?.[1] ?? 0),
      behind: Number(divergence?.[2] ?? 0),
      changedFiles,
      branches: branchOutput.split("\n").filter(Boolean),
      commits: await recentCommits(binding.repositoryPath),
      checkouts,
      ...(iconDataUrl ? { iconDataUrl } : {}),
    };
  } catch (error) {
    return {
      project,
      binding,
      portable,
      available: false,
      branches: [],
      commits: [],
      checkouts,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
