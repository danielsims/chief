import { ArrowLeft, GitCommitHorizontal } from "lucide-react";

import type { ProjectCommitSummary } from "@chief/agent-runtime/types";
import { Button } from "@chief/ui/components/button";

import type { ProjectCurrentUser } from "./project-user-avatar";
import { ProjectCommitList } from "./project-commit-list";

export function ProjectCommitHistory({
  commits,
  currentUser,
  path,
  onBack,
  onSelect,
}: {
  commits: ProjectCommitSummary[];
  currentUser: ProjectCurrentUser | null;
  path: string;
  onBack: () => void;
  onSelect: (commit: ProjectCommitSummary) => void;
}) {
  return (
    <section>
      <div className="mb-4 flex min-h-9 items-center gap-3">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Back to files"
          onClick={onBack}
        >
          <ArrowLeft size={15} />
        </Button>
        <GitCommitHorizontal size={16} className="text-muted-foreground" />
        <div className="min-w-0">
          <h3 className="text-[15px] font-medium">Commit history</h3>
          <p className="text-muted-foreground truncate text-[13px]">
            {path || "All files"}
          </p>
        </div>
      </div>
      <div>
        {commits.length ? (
          <ProjectCommitList
            commits={commits}
            currentUser={currentUser}
            onSelect={onSelect}
            detailed
            limit={50}
          />
        ) : (
          <p className="text-muted-foreground py-14 text-center text-[13px]">
            No commits found for this path.
          </p>
        )}
      </div>
    </section>
  );
}
