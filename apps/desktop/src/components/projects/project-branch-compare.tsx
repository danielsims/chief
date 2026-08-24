import { lazy, Suspense, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  GitCompareArrows,
  GitPullRequest,
} from "lucide-react";

import type {
  ProjectRepositorySnapshot,
  ProviderPullRequest,
} from "@chief/agent-runtime/types";
import { Button } from "@chief/ui/components/button";
import { Input } from "@chief/ui/components/input";
import { cn } from "@chief/ui/lib/utils";

import type { ProjectCurrentUser } from "./project-user-avatar";
import { useProjectPullRequest } from "../../lib/runtime-project-actions";
import { useProjectComparison } from "../../lib/runtime-projects";
import { ProjectBranchPicker } from "./project-branch-picker";
import { ProjectCommitList } from "./project-commit-list";

const ProjectDiffLazy = lazy(() =>
  import("./project-diff").then((module) => ({
    default: module.ProjectDiffView,
  })),
);

function CreatedPullRequest({
  pullRequest,
}: {
  pullRequest: ProviderPullRequest;
}) {
  return (
    <p className="mt-2 text-[12px] text-emerald-600">
      Pull request #{pullRequest.number} created
      {pullRequest.url ? (
        <>
          {" — "}
          <a
            href={pullRequest.url}
            className="underline"
            onClick={(event) => {
              event.preventDefault();
              window.open(pullRequest.url, "_blank");
            }}
          >
            Open on GitHub
          </a>
        </>
      ) : null}
    </p>
  );
}

function refOptions(snapshot: ProjectRepositorySnapshot) {
  const branches = new Set(snapshot.branches);
  for (const checkout of snapshot.checkouts) {
    branches.add(checkout.branch);
  }
  return [snapshot.project.defaultBranch, ...branches].filter(
    (branch, index, all) => all.indexOf(branch) === index,
  );
}

function CompareEmptyState({
  snapshot,
  baseRef,
  onCompareChange,
}: {
  snapshot: ProjectRepositorySnapshot;
  baseRef: string;
  onCompareChange: (ref: string) => void;
}) {
  const branches = (snapshot.branchSummaries ?? []).slice(0, 8);
  return (
    <div className="border-border/70 mt-5 rounded-xl border">
      <div className="flex flex-col items-center px-6 py-12 text-center">
        <GitCompareArrows size={28} className="text-muted-foreground/60" />
        <h4 className="mt-3 text-[16px] font-medium">
          Compare and review changes
        </h4>
        <p className="text-muted-foreground mt-1 max-w-md text-[13px] leading-5">
          Choose different branches above to review changes before publishing or
          opening a pull request.
        </p>
      </div>

      {branches.length ? (
        <div className="border-border/70 border-t">
          <div className="border-border/70 flex h-10 items-center border-b px-4 text-[12px] font-medium">
            Recent branches
          </div>
          {branches.map((branch) => (
            <button
              key={branch.name}
              type="button"
              onClick={() =>
                branch.name !== baseRef && onCompareChange(branch.name)
              }
              className="border-border/70 hover:bg-muted/40 grid w-full grid-cols-[minmax(120px,1fr)_minmax(140px,1.5fr)_auto] items-center gap-3 border-b px-4 py-2.5 text-left text-[13px] last:border-b-0"
            >
              <span className="flex min-w-0 items-center gap-2">
                <span className="truncate font-medium">{branch.name}</span>
                {branch.name === snapshot.project.defaultBranch ? (
                  <span className="text-muted-foreground shrink-0 text-[11px]">
                    Default
                  </span>
                ) : null}
              </span>
              <span className="text-muted-foreground min-w-0 truncate">
                {branch.subject}
              </span>
              {branch.name === baseRef ? (
                <span className="text-muted-foreground shrink-0 text-[12px]">
                  Base
                </span>
              ) : (
                <span className="shrink-0 font-mono text-[12px]">
                  {branch.shortHash}
                </span>
              )}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function ProjectBranchCompareView({
  snapshot,
  baseRef,
  compareRef,
  currentUser,
  onBaseChange,
  onCompareChange,
  onSwap,
  onBack,
}: {
  snapshot: ProjectRepositorySnapshot;
  baseRef: string;
  compareRef: string;
  currentUser: ProjectCurrentUser | null;
  onBaseChange: (ref: string) => void;
  onCompareChange: (ref: string) => void;
  onSwap: () => void;
  onBack: () => void;
}) {
  const ready = baseRef !== compareRef;
  const { comparison, loading, error } = useProjectComparison(
    snapshot.project.id,
    ready ? baseRef : undefined,
    ready ? compareRef : undefined,
  );
  const options = refOptions(snapshot);
  const pullRequests = snapshot.project.providerId === "github";
  const pullRequest = useProjectPullRequest();
  const [drafting, setDrafting] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  return (
    <section className="min-w-0">
      <div className="flex min-h-9 items-center gap-3">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Back to files"
          onClick={onBack}
        >
          <ArrowLeft size={15} />
        </Button>
        <GitCompareArrows size={16} className="text-muted-foreground" />
        <h3 className="text-[20px] font-normal tracking-[-0.025em]">
          Compare branches
        </h3>
      </div>

      <div className="border-border/70 mt-4 flex flex-wrap items-center gap-3 rounded-xl border px-3 py-3 text-[13px]">
        <ProjectBranchPicker
          branches={options}
          current={baseRef}
          defaultBranch={snapshot.project.defaultBranch}
          onSelect={onBaseChange}
          label="Base"
        />
        <ArrowRight size={14} className="text-muted-foreground shrink-0" />
        <ProjectBranchPicker
          branches={options}
          current={compareRef}
          defaultBranch={snapshot.project.defaultBranch}
          onSelect={onCompareChange}
          label="Compare"
        />
        <Button variant="outline" size="sm" onClick={onSwap}>
          Swap
        </Button>
      </div>

      {!ready ? (
        <CompareEmptyState
          snapshot={snapshot}
          baseRef={baseRef}
          onCompareChange={onCompareChange}
        />
      ) : error ? (
        <div className="border-destructive/20 bg-destructive/[0.05] text-destructive mt-5 rounded-xl border px-4 py-3 text-[13px]">
          {error}
        </div>
      ) : loading || !comparison ? (
        <div className="border-border/70 mt-5 min-h-40 rounded-xl border" />
      ) : (
        <>
          <div className="border-border/70 mt-5 flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3">
            <span className="min-w-0 flex-1 text-[13px] leading-5">
              Discuss and review the changes in this comparison with others.
            </span>
            {pullRequests ? (
              <Button
                size="sm"
                disabled={pullRequest.busy}
                onClick={() => {
                  setTitle(
                    title || `Changes from ${compareRef} into ${baseRef}`,
                  );
                  setDrafting(true);
                  pullRequest.clearError();
                }}
              >
                <GitPullRequest size={13} />
                Create pull request
              </Button>
            ) : (
              <span className="text-muted-foreground text-[12px]">
                Pull requests are not available for this repository.
              </span>
            )}
          </div>

          {pullRequests && drafting ? (
            <form
              className="border-border/70 mt-3 rounded-xl border px-4 py-3"
              onSubmit={(event) => {
                event.preventDefault();
                if (!title.trim()) return;
                void pullRequest
                  .create(snapshot.project.id, {
                    title: title.trim(),
                    ...(description.trim()
                      ? { description: description.trim() }
                      : undefined),
                    headBranch: compareRef,
                    baseBranch: baseRef,
                  })
                  .then(() => setDrafting(false));
              }}
            >
              <div className="text-muted-foreground flex min-w-0 items-center gap-2 text-[12px]">
                <span className="shrink-0 font-mono">{baseRef}</span>
                <ArrowRight size={12} className="shrink-0" />
                <span className="shrink-0 font-mono">{compareRef}</span>
              </div>
              <Input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Pull request title"
                className="mt-2 h-9 text-[13px]"
                autoFocus
              />
              <Input
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Description (optional)"
                className="mt-2 h-9 text-[13px]"
              />
              {pullRequest.error ? (
                <p className="border-destructive/20 bg-destructive/[0.05] text-destructive mt-2 rounded-lg border px-3 py-2 text-[12px]">
                  {pullRequest.error}
                </p>
              ) : null}
              {pullRequest.created ? (
                <CreatedPullRequest pullRequest={pullRequest.created} />
              ) : null}
              <div className="mt-3 flex items-center justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setDrafting(false);
                    pullRequest.clearError();
                  }}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  loading={pullRequest.busy}
                  disabled={!title.trim()}
                >
                  Create pull request
                </Button>
              </div>
            </form>
          ) : null}

          <div className="border-border/70 mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border px-4 py-3 text-[12px]">
            <span className="text-[14px] font-medium">
              {comparison.filesChanged}{" "}
              {comparison.filesChanged === 1 ? "file" : "files"} changed
            </span>
            <span className="text-emerald-500">+{comparison.additions}</span>
            <span className="text-red-500">-{comparison.deletions}</span>
            <span className="text-muted-foreground ml-auto">
              {comparison.ahead} commits in, {comparison.behind} behind
            </span>
            {comparison.mergeConflict === undefined ? null : (
              <span
                className={cn(
                  "ml-2 rounded-full px-2.5 py-0.5 text-[11px]",
                  comparison.mergeConflict
                    ? "bg-destructive/10 text-destructive"
                    : "bg-emerald-500/10 text-emerald-600",
                )}
              >
                {comparison.mergeConflict ? "Conflicts" : "Clean merge"}
              </span>
            )}
          </div>

          {comparison.commits.length ? (
            <div className="mt-5">
              <h4 className="text-muted-foreground mb-2 text-[13px]">
                Commits
              </h4>
              <ProjectCommitList
                commits={comparison.commits}
                currentUser={currentUser}
                onSelect={() => undefined}
                detailed
                limit={50}
              />
            </div>
          ) : null}

          {comparison.truncated ? (
            <div className="border-border/70 bg-muted/20 text-muted-foreground mt-5 rounded-xl border px-4 py-3 text-[13px]">
              This comparison is too large to render safely in Chief. Open it
              through the repository host to review the complete diff.
            </div>
          ) : comparison.patch ? (
            <Suspense fallback={<div className="mt-5 min-h-40" />}>
              <div className="mt-6">
                <ProjectDiffLazy patch={comparison.patch} />
              </div>
            </Suspense>
          ) : null}
        </>
      )}
    </section>
  );
}
