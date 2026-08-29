import type {
  ProjectBranchComparison,
  ProjectCommitSummary,
} from "../types.js";
import { git, gitExitCode } from "./repository-git.js";

const MAX_COMPARE_COMMITS = 50;
const MAX_COMPARE_PATCH_BYTES = 3 * 1024 * 1024;

function parseCommit(record: string): ProjectCommitSummary | undefined {
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

function validateRef(ref: string, label: string) {
  const trimmed = ref.trim();
  if (
    !trimmed ||
    trimmed.length > 1024 ||
    trimmed.startsWith("-") ||
    hasControlCharacter(trimmed)
  ) {
    throw new Error(`Use a valid ${label}.`);
  }
  return trimmed;
}

function hasControlCharacter(value: string) {
  for (const character of value) {
    if (character.charCodeAt(0) < 32) return true;
  }
  return false;
}

async function detectMergeConflict(
  repositoryPath: string,
  base: string,
  compare: string,
): Promise<boolean> {
  const exitCode = await gitExitCode(
    ["merge-tree", "--write-tree", "--messages", base, compare],
    repositoryPath,
    60_000,
  );
  if (exitCode === 0) return false;
  if (exitCode === 1) return true;
  throw new Error(`Git merge-tree exited with status ${String(exitCode)}.`);
}

/** Compares two refs with bounded commit, diff, and patch data. */
export async function compareRepositoryBranches(
  projectId: string,
  repositoryPath: string,
  requestedBaseRef: string,
  requestedCompareRef: string,
): Promise<ProjectBranchComparison> {
  const baseRef = validateRef(requestedBaseRef, "base ref");
  const compareRef = validateRef(requestedCompareRef, "compare ref");
  if (baseRef === compareRef) {
    throw new Error("Choose two different branches to compare.");
  }
  const [base, compare, mergeBaseOutput] = await Promise.all([
    git(
      ["rev-parse", "--verify", "--end-of-options", `${baseRef}^{commit}`],
      repositoryPath,
    ),
    git(
      ["rev-parse", "--verify", "--end-of-options", `${compareRef}^{commit}`],
      repositoryPath,
    ),
    git(["merge-base", baseRef, compareRef], repositoryPath).catch(
      () => undefined,
    ),
  ]);
  const mergeBase = mergeBaseOutput?.trim();
  const [aheadOutput, behindOutput, commitOutput, numstatOutput, patchOutput] =
    await Promise.all([
      git(["rev-list", "--count", `${baseRef}..${compareRef}`], repositoryPath),
      git(["rev-list", "--count", `${compareRef}..${baseRef}`], repositoryPath),
      git(
        [
          "log",
          `-${MAX_COMPARE_COMMITS}`,
          "--format=%H%x1f%h%x1f%P%x1f%s%x1f%an%x1f%ae%x1f%at%x1e",
          `${baseRef}..${compareRef}`,
        ],
        repositoryPath,
      ),
      git(
        ["diff", "--numstat", "--find-renames", baseRef, compareRef],
        repositoryPath,
      ),
      git(
        [
          "diff",
          "--find-renames",
          "--no-color",
          "--no-ext-diff",
          baseRef,
          compareRef,
        ],
        repositoryPath,
      ),
    ]);
  const commits = commitOutput.split("\x1e").flatMap((record) => {
    const commit = parseCommit(record);
    return commit ? [commit] : [];
  });
  let additions = 0;
  let deletions = 0;
  let filesChanged = 0;
  for (const line of numstatOutput.split("\n")) {
    if (!line) continue;
    const [added, deleted] = line.split("\t");
    additions += Number.isFinite(Number(added)) ? Number(added) : 0;
    deletions += Number.isFinite(Number(deleted)) ? Number(deleted) : 0;
    filesChanged += 1;
  }
  const patchBytes = Buffer.byteLength(patchOutput, "utf8");
  const conflict = await detectMergeConflict(repositoryPath, base, compare);
  return {
    projectId,
    baseRef,
    compareRef,
    ...(mergeBase ? { mergeBase } : undefined),
    ahead: Number(aheadOutput),
    behind: Number(behindOutput),
    commits,
    filesChanged,
    additions,
    deletions,
    patch: patchBytes > MAX_COMPARE_PATCH_BYTES ? "" : patchOutput,
    truncated: patchBytes > MAX_COMPARE_PATCH_BYTES,
    mergeConflict: conflict,
  };
}
