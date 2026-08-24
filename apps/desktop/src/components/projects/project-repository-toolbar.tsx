import { GitBranch, GitCommitHorizontal, GitCompareArrows } from "lucide-react";

import type { ProjectRepositorySnapshot } from "@chief/agent-runtime/types";

import { ProjectBranchPicker } from "./project-branch-picker";

export function ProjectRepositoryToolbar({
  snapshot,
  selectedRef,
  onSelectRef,
  onOpenHistory,
  onOpenCompare,
}: {
  snapshot: ProjectRepositorySnapshot;
  selectedRef: string;
  onSelectRef: (ref: string) => void;
  onOpenHistory: () => void;
  onOpenCompare: () => void;
}) {
  const { project } = snapshot;
  return (
    <div className="border-border/70 mt-6 flex min-h-14 flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border px-3 py-2.5 text-[13px]">
      <ProjectBranchPicker
        branches={snapshot.branches}
        current={selectedRef}
        defaultBranch={project.defaultBranch}
        onSelect={onSelectRef}
      />
      <span className="text-muted-foreground flex items-center gap-1.5">
        <GitBranch size={14} />
        {snapshot.branches.length} branches
      </span>
      <button
        type="button"
        onClick={onOpenHistory}
        className="text-muted-foreground hover:text-foreground flex items-center gap-1.5 transition-colors"
      >
        <GitCommitHorizontal size={14} />
        Commits
      </button>
      <button
        type="button"
        onClick={onOpenCompare}
        className="text-muted-foreground hover:text-foreground flex items-center gap-1.5 transition-colors"
      >
        <GitCompareArrows size={14} />
        Compare
      </button>
      <span className="text-muted-foreground ml-auto">
        {snapshot.clean
          ? "Working tree clean"
          : `${snapshot.changedFiles} changed files`}
      </span>
    </div>
  );
}
