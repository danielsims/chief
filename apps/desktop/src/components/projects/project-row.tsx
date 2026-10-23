import { GitBranch } from "lucide-react";

import type { ProjectRepositorySnapshot } from "@chief/agent-runtime/types";

import { ListRow } from "../list-row";
import { ProjectIcon } from "./project-icon";

/** A project as one row: its repository, where it lives and its branch. */
export function ProjectRow({
  snapshot,
  onClick,
}: {
  snapshot: ProjectRepositorySnapshot;
  onClick: () => void;
}) {
  const { project } = snapshot;
  return (
    <ListRow
      onClick={onClick}
      leading={
        <ProjectIcon
          dataUrl={snapshot.iconDataUrl}
          className="size-8 rounded-lg"
        />
      }
      title={project.name}
      subtitle={
        project.canonicalRemoteUrl ??
        snapshot.binding?.repositoryPath ??
        "Local-only repository"
      }
      trailing={
        <span className="text-muted-foreground flex w-32 shrink-0 items-center justify-end gap-1.5 text-[12px]">
          {snapshot.portable ? (
            <>
              <GitBranch size={13} className="shrink-0" />
              <span className="truncate">
                {snapshot.branch ?? project.defaultBranch}
              </span>
            </>
          ) : (
            "Local only"
          )}
        </span>
      }
    />
  );
}
