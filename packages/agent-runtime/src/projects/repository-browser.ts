import { dirname, extname, normalize } from "node:path/posix";

import type {
  ProjectCommitDetail,
  ProjectCommitSummary,
  ProjectContributorSummary,
  ProjectFileSnapshot,
  ProjectReadmeSnapshot,
  ProjectRepositoryBrowserSnapshot,
  ProjectTreeEntry,
} from "../types.js";
import { git, gitBuffer, optionalGit } from "./repository-git.js";

const MAX_ENTRIES = 200;
const MAX_TEXT_BYTES = 768 * 1024;
const MAX_README_ASSET_BYTES = 1024 * 1024;
const MAX_README_ASSETS = 16;
const MAX_COMMIT_PATCH_BYTES = 3 * 1024 * 1024;
const readmeAssetTypes: Record<string, string> = {
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

function safePath(value: string | undefined) {
  const trimmed = value?.trim().replaceAll("\\", "/") ?? "";
  if (!trimmed) return "";
  if (
    trimmed.startsWith("/") ||
    trimmed.includes("\0") ||
    trimmed.split("/").some((segment) => segment === "..")
  ) {
    throw new Error("Use a path inside the project repository.");
  }
  return trimmed.replace(/^\.\//, "").replace(/\/$/, "");
}

function hasControlCharacter(value: string) {
  for (const character of value) {
    if (character.charCodeAt(0) < 32) return true;
  }
  return false;
}

function safeRef(value: string | undefined) {
  const trimmed = value?.trim() ?? "";
  if (
    !trimmed ||
    trimmed.length > 1024 ||
    trimmed.startsWith("-") ||
    hasControlCharacter(trimmed)
  ) {
    throw new Error("Use a valid Git ref.");
  }
  return trimmed;
}

function parseCommit(record: string): ProjectCommitSummary | undefined {
  const [hash, shortHash, subject, authorName, authorEmail, authoredAt] = record
    .trim()
    .split("\x1f");
  if (!hash || !shortHash || !subject || !authorName || !authorEmail) {
    return undefined;
  }
  return {
    hash,
    shortHash,
    subject,
    authorName,
    authorEmail,
    authoredAt: Number(authoredAt ?? 0) * 1_000,
  };
}

function parseHistoryCommit(record: string): ProjectCommitSummary | undefined {
  const [
    hash,
    shortHash,
    parents,
    subject,
    authorName,
    authorEmail,
    authoredAt,
  ] = record.trim().split("\x1f");
  if (!hash || !shortHash || !subject || !authorName || !authorEmail) {
    return undefined;
  }
  return {
    hash,
    shortHash,
    parentHashes: parents?.split(" ").filter(Boolean) ?? [],
    subject,
    authorName,
    authorEmail,
    authoredAt: Number(authoredAt ?? 0) * 1_000,
  };
}

async function recentCommits(
  repositoryPath: string,
  ref: string,
  path: string,
) {
  const output = await optionalGit(
    [
      "log",
      "-50",
      "--topo-order",
      "--format=%H%x1f%h%x1f%P%x1f%s%x1f%an%x1f%ae%x1f%at%x1e",
      ref,
      ...(path ? ["--", path] : []),
    ],
    repositoryPath,
  );
  return (output?.split("\x1e") ?? []).flatMap((record) => {
    const commit = parseHistoryCommit(record);
    return commit ? [commit] : [];
  });
}

async function latestCommit(
  repositoryPath: string,
  ref: string,
  path?: string,
) {
  const output = await optionalGit(
    [
      "log",
      "-1",
      "--format=%H%x1f%h%x1f%s%x1f%an%x1f%ae%x1f%at",
      ref,
      ...(path ? ["--", path] : []),
    ],
    repositoryPath,
  );
  return output ? parseCommit(output) : undefined;
}

function immediateChild(currentPath: string, changedPath: string) {
  const prefix = currentPath ? `${currentPath}/` : "";
  if (prefix && !changedPath.startsWith(prefix)) return undefined;
  const relative = prefix ? changedPath.slice(prefix.length) : changedPath;
  const first = relative.split("/")[0];
  return first ? (prefix ? `${prefix}${first}` : first) : undefined;
}

async function recentEntryCommits(
  repositoryPath: string,
  ref: string,
  path: string,
) {
  const output = await optionalGit(
    [
      "log",
      "-200",
      "--format=%x1e%H%x1f%h%x1f%s%x1f%an%x1f%ae%x1f%at",
      "--name-only",
      ref,
      ...(path ? ["--", path] : []),
    ],
    repositoryPath,
  );
  const result = new Map<string, ProjectCommitSummary>();
  for (const section of output?.split("\x1e") ?? []) {
    const [header, ...changedPaths] = section.trim().split("\n");
    const commit = header ? parseCommit(header) : undefined;
    if (!commit) continue;
    for (const changedPath of changedPaths) {
      const child = immediateChild(path, changedPath.trim());
      if (child && !result.has(child)) result.set(child, commit);
    }
  }
  return result;
}

function parseTree(output: string, path: string) {
  const entries: ProjectTreeEntry[] = [];
  for (const record of output.split("\0")) {
    if (!record) continue;
    const tab = record.indexOf("\t");
    if (tab < 0) continue;
    const metadata = record.slice(0, tab).split(/\s+/);
    const name = record.slice(tab + 1);
    const [, objectType, , objectSize] = metadata;
    if (!name || !objectType) continue;
    const entryPath = path ? `${path}/${name}` : name;
    entries.push({
      name,
      path: entryPath,
      type:
        objectType === "tree"
          ? "directory"
          : objectType === "commit"
            ? "submodule"
            : "file",
      ...(objectSize && objectSize !== "-" ? { size: Number(objectSize) } : {}),
    });
    if (entries.length >= MAX_ENTRIES) break;
  }
  return entries.sort((left, right) => {
    if (left.type === "directory" && right.type !== "directory") return -1;
    if (left.type !== "directory" && right.type === "directory") return 1;
    return left.name.localeCompare(right.name);
  });
}

async function textObject(
  repositoryPath: string,
  object: string,
): Promise<ProjectFileSnapshot> {
  const size = Number(await git(["cat-file", "-s", object], repositoryPath));
  if (size > MAX_TEXT_BYTES) {
    return { path: "", size, binary: false, truncated: true };
  }
  const buffer = await gitBuffer(["show", object], repositoryPath);
  const binary = buffer.includes(0);
  return {
    path: "",
    size,
    ...(binary ? {} : { content: buffer.toString("utf8") }),
    binary,
    truncated: false,
  };
}

function relativeReadmeTargets(content: string) {
  const results = new Set<string>();
  for (const match of content.matchAll(/!\[[^\]]*\]\(\s*<?([^\s)>]+)>?/g)) {
    if (match[1]) results.add(match[1]);
  }
  for (const match of content.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["']/gi)) {
    if (match[1]) results.add(match[1]);
  }
  return [...results].slice(0, MAX_README_ASSETS);
}

function htmlAttribute(attributes: string, name: string) {
  const match = new RegExp(
    `\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
    "i",
  ).exec(attributes);
  return match?.[1] ?? match?.[2] ?? match?.[3];
}

function normalizeReadmeImages(content: string) {
  const linked = content.replace(
    /<a\b([^>]*)>\s*<img\b([^>]*)\/?\s*>\s*<\/a>/gi,
    (source, anchorAttributes: string, imageAttributes: string) => {
      const href = htmlAttribute(anchorAttributes, "href");
      const src = htmlAttribute(imageAttributes, "src");
      const alt = htmlAttribute(imageAttributes, "alt") ?? "";
      return href && src
        ? `[![${alt.replaceAll("]", "\\]")}](${src})](${href})`
        : source;
    },
  );
  return linked.replace(
    /<img\b([^>]*)\/?\s*>/gi,
    (source, attributes: string) => {
      const src = htmlAttribute(attributes, "src");
      const alt = htmlAttribute(attributes, "alt") ?? "";
      return src ? `![${alt.replaceAll("]", "\\]")}](${src})` : source;
    },
  );
}

function repositoryAssetPath(readmePath: string, target: string) {
  if (/^(?:[a-z]+:|\/|#)/i.test(target)) return undefined;
  let decoded: string;
  try {
    decoded = decodeURIComponent(target.split(/[?#]/)[0] ?? "");
  } catch {
    return undefined;
  }
  const path = normalize(`${dirname(readmePath)}/${decoded}`);
  if (!path || path === "." || path === ".." || path.startsWith("../")) {
    return undefined;
  }
  return path.replace(/^\.\//, "");
}

async function embedReadmeImages(
  repositoryPath: string,
  ref: string,
  readmePath: string,
  content: string,
) {
  const normalized = normalizeReadmeImages(content);
  const replacements = new Map<string, string>();
  const imageSources: Record<string, string> = {};
  await Promise.all(
    relativeReadmeTargets(normalized).map(async (target, index) => {
      const path = repositoryAssetPath(readmePath, target);
      const mimeType = path
        ? readmeAssetTypes[extname(path).toLowerCase()]
        : undefined;
      if (!path || !mimeType) return;
      const object = `${ref}:${path}`;
      try {
        const size = Number(
          await git(["cat-file", "-s", object], repositoryPath),
        );
        if (size > MAX_README_ASSET_BYTES) return;
        const buffer = await gitBuffer(["show", object], repositoryPath);
        const placeholder = `https://chief.local/readme-assets/${index}`;
        replacements.set(target, placeholder);
        imageSources[placeholder] =
          `data:${mimeType};base64,${buffer.toString("base64")}`;
      } catch {
        // Missing image references remain untouched instead of failing README.
      }
    }),
  );
  let rewritten = normalized;
  for (const [target, dataUrl] of replacements) {
    rewritten = rewritten.split(target).join(dataUrl);
  }
  return { content: rewritten, imageSources };
}

async function readmeSnapshot(
  repositoryPath: string,
  ref: string,
  path: string,
  entries: ProjectTreeEntry[],
): Promise<ProjectReadmeSnapshot | undefined> {
  const readme = entries.find(
    (entry) =>
      entry.type === "file" &&
      /^readme(?:\.(?:md|markdown|txt))?$/i.test(entry.name),
  );
  if (!readme) return undefined;
  const file = await textObject(repositoryPath, `${ref}:${readme.path}`);
  if (file.binary) return undefined;
  const embedded = await embedReadmeImages(
    repositoryPath,
    ref,
    readme.path,
    file.content ?? "",
  );
  return {
    path: readme.path,
    content: embedded.content,
    imageSources: embedded.imageSources,
    truncated: file.truncated,
  };
}

async function contributors(repositoryPath: string, ref: string) {
  const output = await optionalGit(
    ["shortlog", "-sne", "--no-merges", ref],
    repositoryPath,
  );
  return (output?.split("\n") ?? [])
    .flatMap((line): ProjectContributorSummary[] => {
      const match = /^\s*(\d+)\s+(.+?)\s+<([^>]+)>\s*$/.exec(line);
      return match?.[1] && match[2] && match[3]
        ? [
            {
              commits: Number(match[1]),
              name: match[2],
              email: match[3],
            },
          ]
        : [];
    })
    .slice(0, 8);
}

export async function browseRepository(
  projectId: string,
  repositoryPath: string,
  requestedRef: string,
  requestedPath?: string,
): Promise<ProjectRepositoryBrowserSnapshot> {
  const ref = safeRef(requestedRef);
  const path = safePath(requestedPath);
  await git(
    ["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`],
    repositoryPath,
  );
  const object = path ? `${ref}:${path}` : `${ref}^{tree}`;
  const kind = await git(["cat-file", "-t", object], repositoryPath);
  const [commit, commits, projectContributors] = await Promise.all([
    latestCommit(repositoryPath, ref, path),
    recentCommits(repositoryPath, ref, path),
    contributors(repositoryPath, ref),
  ]);
  if (kind === "blob") {
    const file = await textObject(repositoryPath, object);
    return {
      projectId,
      ref,
      path,
      kind: "file",
      ...(commit ? { latestCommit: commit } : {}),
      commits,
      entries: [],
      contributors: projectContributors,
      file: { ...file, path },
    };
  }
  if (kind !== "tree") throw new Error("This Git object cannot be browsed.");
  const [treeOutput, pathCommits] = await Promise.all([
    git(["ls-tree", "-z", "-l", object], repositoryPath),
    recentEntryCommits(repositoryPath, ref, path),
  ]);
  const entries = parseTree(treeOutput, path).map((entry) => ({
    ...entry,
    ...(pathCommits.get(entry.path)
      ? { lastCommit: pathCommits.get(entry.path) }
      : {}),
  }));
  const readme = await readmeSnapshot(repositoryPath, ref, path, entries);
  return {
    projectId,
    ref,
    path,
    kind: "tree",
    ...(commit ? { latestCommit: commit } : {}),
    commits,
    entries,
    contributors: projectContributors,
    ...(readme ? { readme } : {}),
  };
}

export async function inspectRepositoryCommit(
  projectId: string,
  repositoryPath: string,
  requestedRef: string,
  requestedCommit: string,
): Promise<ProjectCommitDetail> {
  const ref = safeRef(requestedRef);
  const commitInput = requestedCommit.trim();
  if (!/^[0-9a-f]{7,64}$/i.test(commitInput)) {
    throw new Error("Use a valid commit hash.");
  }
  const hash = await git(
    ["rev-parse", "--verify", "--end-of-options", `${commitInput}^{commit}`],
    repositoryPath,
  );
  await git(["merge-base", "--is-ancestor", hash, ref], repositoryPath);
  const [header, numstat, rawPatch] = await Promise.all([
    git(
      [
        "show",
        "-s",
        "--format=%H%x1f%h%x1f%P%x1f%s%x1f%an%x1f%ae%x1f%at",
        hash,
      ],
      repositoryPath,
    ),
    git(
      ["show", "--format=", "--numstat", "--find-renames", hash],
      repositoryPath,
    ),
    git(
      [
        "show",
        "--format=",
        "--patch",
        "--no-color",
        "--no-ext-diff",
        "--find-renames",
        hash,
      ],
      repositoryPath,
    ),
  ]);
  const commit = parseHistoryCommit(header);
  if (!commit) throw new Error("Chief could not read this commit.");
  let additions = 0;
  let deletions = 0;
  let filesChanged = 0;
  for (const line of numstat.split("\n")) {
    if (!line) continue;
    const [added, deleted] = line.split("\t");
    additions += Number.isFinite(Number(added)) ? Number(added) : 0;
    deletions += Number.isFinite(Number(deleted)) ? Number(deleted) : 0;
    filesChanged += 1;
  }
  const patchBytes = Buffer.byteLength(rawPatch, "utf8");
  return {
    projectId,
    ref,
    commit,
    filesChanged,
    additions,
    deletions,
    patch: patchBytes > MAX_COMMIT_PATCH_BYTES ? "" : rawPatch,
    truncated: patchBytes > MAX_COMMIT_PATCH_BYTES,
  };
}
