import { z } from "zod";

import type { AgentPrincipal } from "@chief/relay-contracts";

import { HttpError } from "./http";
import { withTrustedContext } from "./internal-context";
import { githubRepositoryIdentity } from "./project-repository";
import { projectsFindWorkspaceProjects } from "./queries/projects/find-workspace-projects";
import {
  gitRepoSlug,
  publishGitTree,
  readGitHead,
} from "./workspace-git-store";
import { WorkspaceGitHubService } from "./workspace-github-service";
import { workspaceGitRepositoryFiles } from "./workspace-project-git";

// A single import is bounded so a huge repository cannot exhaust the relay's
// memory or the Durable Object's SQL row limits.
const MAX_IMPORT_BYTES = 6_000_000;
const MAX_IMPORT_FILES = 5_000;
const SKIP_SEGMENTS = new Set([
  ".git",
  "node_modules",
  ".next",
  "dist",
  "build",
  ".turbo",
  ".cache",
]);

interface ImportedFile {
  path: string;
  content: string;
}

/**
 * Ensures the workspace's own Git host has a repository for `repo`, importing
 * the files of the matching GitHub project the first time. Returns false when
 * there is nothing to import (no project, or a non-GitHub project).
 */
export async function ensureProjectImported(
  storage: DurableObjectStorage,
  env: Env,
  principal: AgentPrincipal,
  repo: string,
): Promise<boolean> {
  const slug = gitRepoSlug(repo);
  if (
    readGitHead(storage, slug) ||
    workspaceGitRepositoryFiles(storage, slug)
  ) {
    return true;
  }
  const project = findProjectByRepo(storage, slug);
  const identity = githubRepositoryIdentity(
    project?.canonical_remote_url ?? "",
  );
  if (!identity) return false;
  const ref = project?.default_branch?.trim();
  const files = await fetchGitHubFiles(
    storage,
    env,
    principal,
    identity,
    ref === undefined || ref === "" ? "main" : ref,
  );
  await publishGitTree(storage, {
    repo: slug,
    files,
    message: `Import ${identity.owner}/${identity.name}`,
    authorName: "Chief",
    authorEmail: "chief@heychief.sh",
  });
  return true;
}

function findProjectByRepo(storage: DurableObjectStorage, repo: string) {
  const rows = [
    ...projectsFindWorkspaceProjects<{
      canonical_remote_url: string | null;
      default_branch: string | null;
    }>(storage),
  ];
  return rows.find((row) => {
    const remote = row.canonical_remote_url?.replace(/\.git$/u, "") ?? "";
    return gitRepoSlug(remote.split("/").at(-1) ?? "") === repo;
  });
}

async function fetchGitHubFiles(
  storage: DurableObjectStorage,
  env: Env,
  principal: AgentPrincipal,
  identity: { owner: string; name: string },
  ref: string,
): Promise<ImportedFile[]> {
  const token = await cloneToken(storage, env, principal, identity);
  const response = await fetch(
    `https://api.github.com/repos/${encodeURIComponent(identity.owner)}/${encodeURIComponent(identity.name)}/tarball/${encodeURIComponent(ref)}`,
    {
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "user-agent": "Chief-Relay",
        "x-github-api-version": "2026-03-10",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!response.ok) {
    await response.body?.cancel();
    throw new HttpError(
      502,
      "github_import_failed",
      `GitHub could not export this repository (HTTP ${response.status}).`,
    );
  }
  const files = await extractTarGz(await response.blob());
  if (files.length === 0) {
    throw new HttpError(
      422,
      "github_import_empty",
      "This repository has no importable files.",
    );
  }
  return files;
}

async function cloneToken(
  storage: DurableObjectStorage,
  env: Env,
  principal: AgentPrincipal,
  identity: { owner: string; name: string },
) {
  const service = new WorkspaceGitHubService(storage, env);
  const response = await service.cloneToken(
    withTrustedContext(
      new Request("https://workspace.internal/github", {
        method: "POST",
        body: JSON.stringify({
          repository: `${identity.owner}/${identity.name}`,
        }),
        headers: { "content-type": "application/json" },
      }),
      {
        principal,
        requestId: crypto.randomUUID(),
        workspaceId: principal.workspaceId,
      },
    ),
  );
  const data = cloneTokenSchema.parse(await response.json());
  return data.token;
}

/** Extracts the regular files from a gzipped tar blob, bounding total size. */
export async function extractTarGz(blob: Blob): Promise<ImportedFile[]> {
  const reader = blob
    .stream()
    .pipeThrough(new DecompressionStream("gzip"))
    .getReader();
  const files: ImportedFile[] = [];
  let buffer = new Uint8Array(0);
  let totalBytes = 0;
  let longName: string | undefined;
  let paxPath: string | undefined;
  const decoder = new TextDecoder();

  const fill = async (length: number) => {
    while (buffer.byteLength < length) {
      const { value, done } = await reader.read();
      if (done) return false;
      buffer = concat(buffer, value);
    }
    return true;
  };

  while (await fill(512)) {
    const header = buffer.subarray(0, 512);
    buffer = buffer.subarray(512);
    if (isZeroBlock(header)) break;
    const size = parseOctal(header, 124, 136);
    const typeflag = String.fromCharCode(header[156] ?? 0);
    const padded = size + ((512 - (size % 512)) % 512);
    if (!(await fill(padded))) break;
    const data = buffer.subarray(0, size);
    buffer = buffer.subarray(padded);
    const name = headerName(header);

    if (typeflag === "L") {
      longName = decoder.decode(data);
      continue;
    }
    if (typeflag === "x" || typeflag === "g") {
      paxPath = parsePaxPath(data) ?? paxPath;
      continue;
    }
    const finalName = paxPath ?? longName ?? name;
    longName = undefined;
    paxPath = undefined;
    if (typeflag !== "0" && typeflag !== "\0" && typeflag !== "") continue;
    const path = stripRoot(finalName);
    if (!path || shouldSkip(path)) continue;
    totalBytes += size;
    if (totalBytes > MAX_IMPORT_BYTES || files.length >= MAX_IMPORT_FILES) {
      throw new HttpError(
        413,
        "github_import_too_large",
        "This repository is too large to import into the workspace Git host.",
      );
    }
    files.push({ path, content: decoder.decode(data) });
  }
  return files;
}

function headerName(header: Uint8Array) {
  const name = readString(header, 0, 100);
  const prefix = readString(header, 345, 500);
  return prefix ? `${prefix}/${name}` : name;
}

function readString(bytes: Uint8Array, start: number, end: number) {
  let value = "";
  for (let index = start; index < end; index += 1) {
    const byte = bytes[index] ?? 0;
    if (byte === 0) break;
    value += String.fromCharCode(byte);
  }
  return value;
}

function parseOctal(bytes: Uint8Array, start: number, end: number) {
  const text = readString(bytes, start, end).trim();
  const value = Number.parseInt(text || "0", 8);
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

function parsePaxPath(data: Uint8Array) {
  const text = new TextDecoder().decode(data);
  for (const record of text.split("\n")) {
    const separator = record.indexOf(" ");
    const equals = record.indexOf("=");
    if (separator < 0 || equals < 0 || equals < separator) continue;
    const key = record.slice(separator + 1, equals);
    if (key === "path") return record.slice(equals + 1);
  }
  return undefined;
}

function isZeroBlock(block: Uint8Array) {
  for (const byte of block) if (byte !== 0) return false;
  return true;
}

function stripRoot(path: string) {
  const separator = path.indexOf("/");
  return separator < 0 ? "" : path.slice(separator + 1);
}

function shouldSkip(path: string) {
  if (path.startsWith(".")) return true;
  return path.split("/").some((segment) => SKIP_SEGMENTS.has(segment));
}

function concat(left: Uint8Array, right: Uint8Array) {
  const bytes = new Uint8Array(left.byteLength + right.byteLength);
  bytes.set(left, 0);
  bytes.set(right, left.byteLength);
  return bytes;
}

const cloneTokenSchema = z.object({ token: z.string().min(1) });
