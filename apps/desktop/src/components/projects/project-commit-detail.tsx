import { PatchDiff } from "@pierre/diffs/react";
import { ArrowLeft, GitCommitHorizontal } from "lucide-react";

import type {
  ProjectCommitDetail,
  ProjectCommitSummary,
} from "@chief/agent-runtime/types";
import { Button } from "@chief/ui/components/button";

import type { ProjectCurrentUser } from "./project-user-avatar";
import { useTheme } from "../../lib/theme";
import { formatProjectTime } from "./project-format";
import { ProjectUserAvatar } from "./project-user-avatar";

export function ProjectCommitDetailView({
  commit,
  detail,
  currentUser,
  loading,
  error,
  onBack,
}: {
  commit: ProjectCommitSummary;
  detail: ProjectCommitDetail | undefined;
  currentUser: ProjectCurrentUser | null;
  loading: boolean;
  error: string | null;
  onBack: () => void;
}) {
  const { resolved } = useTheme();

  return (
    <section className="min-w-0">
      <div className="flex min-h-9 items-center gap-3">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Back to commit history"
          onClick={onBack}
        >
          <ArrowLeft size={15} />
        </Button>
        <GitCommitHorizontal size={16} className="text-muted-foreground" />
        <h3 className="text-[20px] font-normal tracking-[-0.025em]">
          Commit <span className="font-mono">{commit.shortHash}</span>
        </h3>
      </div>

      <div className="mt-4 flex items-center gap-2.5">
        <ProjectUserAvatar
          name={commit.authorName}
          email={commit.authorEmail}
          currentUser={currentUser}
          className="size-8"
        />
        <p className="text-[13px]">
          <span className="font-medium">{commit.authorName}</span>{" "}
          <span className="text-muted-foreground">
            committed {formatProjectTime(commit.authoredAt)}
          </span>
        </p>
      </div>

      <div className="border-border/70 mt-5 overflow-hidden rounded-xl border">
        <div className="px-4 py-3 text-[14px] font-medium">
          {commit.subject}
        </div>
        <div className="border-border/70 text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 border-t px-4 py-2.5 text-[12px]">
          {detail ? (
            <>
              <span>
                {detail.filesChanged}{" "}
                {detail.filesChanged === 1 ? "file" : "files"} changed
              </span>
              <span className="text-emerald-500">+{detail.additions}</span>
              <span className="text-red-500">-{detail.deletions}</span>
              {commit.parentHashes?.[0] ? (
                <span className="ml-auto font-mono">
                  Parent {commit.parentHashes[0].slice(0, 7)}
                </span>
              ) : null}
            </>
          ) : (
            <span>{loading ? "Loading changes…" : "Commit details"}</span>
          )}
        </div>
      </div>

      {error ? (
        <div className="border-destructive/20 bg-destructive/[0.05] text-destructive mt-5 rounded-xl border px-4 py-3 text-[13px]">
          {error}
        </div>
      ) : null}

      {detail?.truncated ? (
        <div className="border-border/70 bg-muted/20 text-muted-foreground mt-5 rounded-xl border px-4 py-3 text-[13px]">
          This commit is too large to render safely in Chief. Open it through
          the repository host to review the complete patch.
        </div>
      ) : null}

      {detail?.patch ? (
        <div className="mt-6 min-w-0 overflow-x-auto text-[13px]">
          <PatchDiff
            patch={detail.patch}
            disableWorkerPool
            options={{
              theme: { dark: "github-dark", light: "github-light" },
              themeType: resolved,
              diffStyle: "unified",
              hunkSeparators: "line-info",
              overflow: "scroll",
              stickyHeader: true,
            }}
          />
        </div>
      ) : null}
    </section>
  );
}
