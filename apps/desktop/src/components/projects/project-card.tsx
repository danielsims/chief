import { GitBranch, GitCommitHorizontal } from "lucide-react";

import type { ProjectRepositorySnapshot } from "@chief/agent-runtime/types";

import { ProjectIcon } from "./project-icon";

export function ProjectCard({
  snapshot,
  onClick,
}: {
  snapshot: ProjectRepositorySnapshot;
  onClick: () => void;
}) {
  const { project } = snapshot;
  return (
    <button
      type="button"
      onClick={onClick}
      className="bg-muted hover:bg-accent/70 group flex min-h-[116px] w-full flex-col rounded-2xl px-4 py-4 text-left shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_7%,transparent),0_1px_2px_rgba(0,0,0,0.025)] transition-[background-color,box-shadow]"
    >
      <span className="flex w-full items-start gap-3">
        <ProjectIcon dataUrl={snapshot.iconDataUrl} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-medium">
            {project.name}
          </span>
          <span className="text-muted-foreground mt-1 block truncate text-[12px] leading-4">
            {project.canonicalRemoteUrl ??
              snapshot.binding?.repositoryPath ??
              "Local-only repository"}
          </span>
        </span>
      </span>
      <span className="text-muted-foreground mt-auto flex w-full items-center gap-4 pt-3 text-[12px] leading-4">
        <span className="flex min-w-0 items-center gap-1.5">
          <GitBranch size={13} />
          <span className="truncate">
            {snapshot.branch ?? project.defaultBranch}
          </span>
        </span>
        <span>
          {snapshot.available
            ? snapshot.clean
              ? "Clean"
              : `${snapshot.changedFiles ?? 0} changed`
            : snapshot.portable
              ? "Not on this runtime"
              : "Local only"}
        </span>
        {snapshot.commits[0] ? (
          <span className="ml-auto flex min-w-0 items-center gap-1.5">
            <GitCommitHorizontal size={13} />
            <span className="truncate">{snapshot.commits[0].shortHash}</span>
          </span>
        ) : null}
      </span>
    </button>
  );
}
