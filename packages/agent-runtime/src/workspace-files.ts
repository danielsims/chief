import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  posix,
  resolve,
  sep,
} from "node:path";

import { workspaceRoot } from "./workspace-secrets.js";

const MAX_TEXT_FILE_BYTES = 1_000_000;

function slug(value: string) {
  const next = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return next || "untitled";
}

export function defaultWorkspaceFilePath(
  name: string,
  kind: "document" | "email",
) {
  return `${kind === "email" ? "emails" : "documents"}/${slug(name)}.md`;
}

export function normalizeWorkspaceFilePath(input: string) {
  const clean = input.trim().replaceAll("\\", "/");
  if (!clean || isAbsolute(clean) || clean.includes("\0")) {
    throw new Error("File path must be relative to this workspace.");
  }
  const normalized = posix.normalize(clean).replace(/^\.\//, "");
  if (
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized
      .split("/")
      .some((part) => !part || part === "." || part.startsWith("."))
  ) {
    throw new Error("File path is outside the workspace library.");
  }
  if (!/\.(md|txt)$/i.test(normalized)) {
    throw new Error("Editable files must use a .md or .txt extension.");
  }
  if (normalized.length > 240) {
    throw new Error("File paths are limited to 240 characters.");
  }
  return normalized;
}

export function assertWorkspaceTextContent(content: string) {
  const size = Buffer.byteLength(content, "utf8");
  if (size > MAX_TEXT_FILE_BYTES) {
    throw new Error("Editable files are limited to 1 MB.");
  }
  return size;
}

function libraryRoot(workspaceId: string) {
  return join(workspaceRoot(workspaceId), "files");
}

function scopedPath(workspaceId: string, relativePath: string) {
  const root = resolve(libraryRoot(workspaceId));
  const target = resolve(root, normalizeWorkspaceFilePath(relativePath));
  if (!target.startsWith(`${root}${sep}`) && target !== root) {
    throw new Error("File path is outside the workspace library.");
  }
  return target;
}

export function stageWorkspaceFileContent(
  workspaceId: string,
  relativePath: string,
  fileId: string,
  versionId: string,
  content: string,
) {
  assertWorkspaceTextContent(content);
  const currentPath = scopedPath(workspaceId, relativePath);
  mkdirSync(dirname(currentPath), { recursive: true, mode: 0o700 });
  const temporaryPath = join(
    dirname(currentPath),
    `.${basename(currentPath)}.${versionId}.tmp`,
  );
  writeFileSync(temporaryPath, content, { encoding: "utf8", mode: 0o600 });
  const revisionPath = join(
    libraryRoot(workspaceId),
    ".versions",
    fileId,
    `${versionId}.md`,
  );
  mkdirSync(dirname(revisionPath), { recursive: true, mode: 0o700 });
  writeFileSync(revisionPath, content, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
  return {
    commit() {
      renameSync(temporaryPath, currentPath);
    },
    discard() {
      rmSync(temporaryPath, { force: true });
      rmSync(revisionPath, { force: true });
    },
  };
}

export function repairWorkspaceFileContent(
  workspaceId: string,
  relativePath: string,
  versionId: string,
  content: string,
) {
  const currentPath = scopedPath(workspaceId, relativePath);
  mkdirSync(dirname(currentPath), { recursive: true, mode: 0o700 });
  const temporaryPath = join(
    dirname(currentPath),
    `.${basename(currentPath)}.${versionId}.repair.tmp`,
  );
  writeFileSync(temporaryPath, content, { encoding: "utf8", mode: 0o600 });
  renameSync(temporaryPath, currentPath);
}

export function removeWorkspaceFileContent(
  workspaceId: string,
  relativePath: string,
  fileId: string,
) {
  rmSync(scopedPath(workspaceId, relativePath), { force: true });
  rmSync(join(libraryRoot(workspaceId), ".versions", fileId), {
    recursive: true,
    force: true,
  });
}
