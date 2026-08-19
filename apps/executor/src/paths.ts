import path from "node:path";

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
