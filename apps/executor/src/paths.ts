import { lstat, mkdir } from "node:fs/promises";
import path from "node:path";

import type { ExecutionLease } from "@chief/relay-contracts";

export function executionRoot(
  root: string,
  lease: Pick<ExecutionLease, "agentId" | "workspaceId">,
) {
  return path.join(
    path.resolve(root),
    "workspaces",
    lease.workspaceId,
    "agents",
    lease.agentId,
  );
}

export async function resolveLeasePath(
  root: string,
  lease: ExecutionLease,
  relativePath: string,
) {
  const leaseRoot = executionRoot(root, lease);
  await mkdir(leaseRoot, { recursive: true });
  const resolved = resolveExecutionPath(leaseRoot, relativePath);
  const relative = path.relative(leaseRoot, resolved);
  let current = leaseRoot;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    const entry = await lstat(current).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
    if (!entry) break;
    if (entry.isSymbolicLink()) {
      throw new PathBoundaryError("Execution paths cannot traverse symlinks.");
    }
  }
  return resolved;
}

export function resolveExecutionPath(root: string, relativePath: string) {
  const absoluteRoot = path.resolve(root);
  const resolved = path.resolve(absoluteRoot, relativePath);
  const relative = path.relative(absoluteRoot, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new PathBoundaryError("Path leaves the execution root.");
  }
  return resolved;
}

export class PathBoundaryError extends Error {}
