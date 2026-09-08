import type {
  ProjectRecord,
  ProjectRepositoryBrowserSnapshot,
  ProjectRepositorySnapshot,
} from "@chief/agent-runtime/types";
import type { RelayProject } from "@chief/relay-contracts";

export function relayProjectRecord(project: RelayProject): ProjectRecord {
  return {
    ...project,
    createdAt: Date.parse(project.createdAt),
    updatedAt: Date.parse(project.updatedAt),
  };
}

export function relayProjectSnapshot(
  project: RelayProject,
): ProjectRepositorySnapshot {
  const record = relayProjectRecord(project);
  const hasRepositoryFiles = Boolean(record.repositoryFiles?.length);
  return {
    project: record,
    portable: Boolean(record.canonicalRemoteUrl) || hasRepositoryFiles,
    available: hasRepositoryFiles,
    branch: record.defaultBranch,
    clean: hasRepositoryFiles ? true : undefined,
    changedFiles: hasRepositoryFiles ? 0 : undefined,
    branches: [record.defaultBranch],
    commits: [],
    checkouts: [],
    ...(!hasRepositoryFiles
      ? {
          error:
            "Chief cannot read this repository from the relay yet. Connect its Git provider to browse files here.",
        }
      : undefined),
  };
}

export function relayProjectBrowser(
  project: ProjectRecord,
  ref: string,
  requestedPath: string,
): ProjectRepositoryBrowserSnapshot | undefined {
  const files = project.repositoryFiles;
  if (!files?.length) return undefined;
  const path = requestedPath.replace(/^\/+|\/+$/gu, "");
  const selectedFile = files.find((file) => file.path === path);
  const base = {
    projectId: project.id,
    ref,
    path,
    commits: [],
    contributors: [],
  };
  if (selectedFile) {
    return {
      ...base,
      kind: "file",
      entries: [],
      file: {
        path: selectedFile.path,
        size: new TextEncoder().encode(selectedFile.content).byteLength,
        content: selectedFile.content,
        binary: false,
        truncated: false,
      },
    };
  }
  const prefix = path ? `${path}/` : "";
  const entries = new Map<
    string,
    { name: string; path: string; type: "directory" | "file"; size?: number }
  >();
  for (const file of files) {
    if (!file.path.startsWith(prefix)) continue;
    const relative = file.path.slice(prefix.length);
    const [name, ...rest] = relative.split("/");
    if (!name) continue;
    const entryPath = prefix + name;
    entries.set(
      name,
      rest.length
        ? { name, path: entryPath, type: "directory" }
        : {
            name,
            path: entryPath,
            type: "file",
            size: new TextEncoder().encode(file.content).byteLength,
          },
    );
  }
  const readme = path
    ? undefined
    : files.find((file) => /^readme\.md$/iu.test(file.path));
  return {
    ...base,
    kind: "tree",
    entries: [...entries.values()].sort((left, right) => {
      if (left.type !== right.type) return left.type === "directory" ? -1 : 1;
      return left.name.localeCompare(right.name);
    }),
    ...(readme
      ? {
          readme: {
            path: readme.path,
            content: readme.content,
            truncated: false,
          },
        }
      : undefined),
  };
}

export function relayProjectSnapshots(
  projects: readonly RelayProject[],
): ProjectRepositorySnapshot[] {
  return projects.map(relayProjectSnapshot);
}
