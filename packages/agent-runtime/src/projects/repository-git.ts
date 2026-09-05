import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { isJsonObject, isJsonString } from "@chief/relay-contracts";

import type {
  ProjectCheckoutRecord,
  ProjectCommitSummary,
  ProjectRecord,
  ProjectRepositoryBindingRecord,
  ProjectRepositorySnapshot,
} from "../types.js";
import { redactUrlCredentials } from "./credential-broker.js";
import { projectIconDataUrl } from "./project-icon.js";

const executeFile = promisify(execFile);
const GIT_TIMEOUT_MS = 30_000;
const GIT_OUTPUT_LIMIT = 4 * 1024 * 1024;

let hooksPathPromise: Promise<string> | undefined;

/**
 * An empty, Chief-owned hooks directory. Repository hooks and `.git/config`
 * are untrusted input, so server-side Git must never execute them. Passing
 * `core.hooksPath` to an empty directory disables every hook for one command
 * without touching the repository's configuration.
 */
async function emptyHooksPath() {
  hooksPathPromise ??= (async () => {
    const path = join(tmpdir(), "chief-no-hooks");
    await mkdir(path, { recursive: true, mode: 0o700 });
    return path;
  })();
  return hooksPathPromise;
}

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
  if (/[\r\n\0]/u.test(trimmed)) throw new Error("Invalid Git remote URL.");
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
  if (parsed.password || parsed.search || parsed.hash) {
    throw new Error("Do not put a credential in the repository URL.");
  }
  if (parsed.protocol === "https:" && parsed.username) {
    throw new Error("Do not put a credential in the repository URL.");
  }
  return trimmed;
}

function textGitError(error: unknown) {
  if (!error || !isJsonObject(error)) return String(error);
  const record = error;
  return redactUrlCredentials(
    [record.stderr, record.stdout, record.message]
      .filter(isJsonString)
      .map((value) => value.trim())
      .find(Boolean) ?? "Git could not complete the operation.",
  );
}

function parseExitCode(value: string | number | null | undefined) {
  const code = Number(value);
  return Number.isInteger(code) ? code : undefined;
}

export async function git(
  args: string[],
  cwd?: string,
  timeout = GIT_TIMEOUT_MS,
) {
  try {
    const result = await executeFile("git", await gitCommand(args), {
      ...(cwd ? { cwd } : undefined),
      encoding: "utf8",
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" },
      maxBuffer: GIT_OUTPUT_LIMIT,
      timeout,
    });
    return result.stdout.trim();
  } catch (error) {
    throw new Error(textGitError(error));
  }
}

export async function gitBuffer(
  args: string[],
  cwd: string,
  timeout = GIT_TIMEOUT_MS,
) {
  const command = await gitCommand(args);
  return new Promise<Buffer>((resolve, reject) => {
    execFile(
      "git",
      command,
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
              textGitError({
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

export async function gitExitCode(
  args: string[],
  cwd: string,
  timeout = GIT_TIMEOUT_MS,
) {
  const command = await gitCommand(args);
  return new Promise<number>((resolve, reject) => {
    execFile(
      "git",
      command,
      {
        cwd,
        encoding: "utf8",
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" },
        maxBuffer: GIT_OUTPUT_LIMIT,
        timeout,
      },
      (error, stdout, stderr) => {
        if (!error) {
          resolve(0);
          return;
        }
        const exitCode = parseExitCode(error.code);
        if (exitCode !== undefined) {
          resolve(exitCode);
          return;
        }
        reject(
          new Error(
            textGitError({
              message: error.message,
              stderr,
              stdout,
            }),
          ),
        );
      },
    );
  });
}

async function gitCommand(args: string[]) {
  const hooksPath = await emptyHooksPath();
  return [
    "-c",
    `core.hooksPath=${hooksPath}`,
    "-c",
    "core.fsmonitor=false",
    ...args,
  ];
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
    const status = await git(
      ["status", "--porcelain=v2", "--branch"],
      binding.repositoryPath,
    );
    const branch = /^# branch\.head (.+)$/m.exec(status)?.[1];
    const head = /^# branch\.oid (.+)$/m.exec(status)?.[1];
    const divergence = /^# branch\.ab \+(\d+) -(\d+)$/m.exec(status);
    const changedFiles = status
      .split("\n")
      .filter((line) => line && !line.startsWith("#")).length;
    const iconDataUrl = await projectIconDataUrl(binding.repositoryPath, head);
    const branchOutput = await git(
      [
        "for-each-ref",
        "--count=40",
        "--format=%(refname:short)%00%(objectname:short)%00%(subject)",
        "refs/heads",
      ],
      binding.repositoryPath,
    );
    const branchSummaries = branchOutput.split("\n").flatMap((line) => {
      const [name, shortHash, subject] = line.split("\0");
      return name && shortHash && subject ? [{ name, shortHash, subject }] : [];
    });
    return {
      project,
      binding,
      portable,
      available: true,
      ...(branch && branch !== "(detached)" ? { branch } : undefined),
      ...(head && head !== "(initial)" ? { head } : undefined),
      clean: changedFiles === 0,
      ahead: Number(divergence?.[1] ?? 0),
      behind: Number(divergence?.[2] ?? 0),
      changedFiles,
      branches: branchSummaries.map((branch) => branch.name),
      branchSummaries,
      commits: await recentCommits(binding.repositoryPath),
      checkouts,
      ...(iconDataUrl ? { iconDataUrl } : undefined),
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
