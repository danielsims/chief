import { lazy, Suspense, useCallback, useState } from "react";
import { openPath, openUrl } from "@tauri-apps/plugin-opener";
import { ArrowLeft, ExternalLink, FolderOpen, RefreshCw } from "lucide-react";

import type {
  ProjectCommitSummary,
  ProjectRepositorySnapshot,
} from "@chief/agent-runtime/types";
import { Button } from "@chief/ui/components/button";
import { cn } from "@chief/ui/lib/utils";

import { useAuth } from "../../lib/auth/auth-context";
import {
  useProjectBrowser,
  useProjectCommit,
} from "../../lib/runtime-projects";
import { ProjectBranchCompareView } from "./project-branch-compare";
import { ProjectCommitHistory } from "./project-commit-history";
import { ProjectFileBrowser } from "./project-file-browser";
import { ProjectIcon } from "./project-icon";
import { ProjectReadme } from "./project-readme";
import { ProjectRepositorySidebar } from "./project-repository-sidebar";
import { ProjectRepositoryToolbar } from "./project-repository-toolbar";

const ProjectCommitDetailView = lazy(async () => ({
  default: (await import("./project-commit-detail")).ProjectCommitDetailView,
}));

export function ProjectDetail({
  snapshot,
  onBack,
  onRefresh,
}: {
  snapshot: ProjectRepositorySnapshot;
  onBack: () => void;
  onRefresh: () => void;
}) {
  const { project } = snapshot;
  const { user } = useAuth();
  const repositoryPath = snapshot.binding?.repositoryPath;
  const repositoryWebUrl = project.repositoryWebUrl;
  const [selectedRef, setSelectedRef] = useState(
    snapshot.branch ?? project.defaultBranch,
  );
  const [selectedPath, setSelectedPath] = useState("");
  const [view, setView] = useState<"files" | "commits" | "commit" | "compare">(
    "files",
  );
  const [selectedCommit, setSelectedCommit] =
    useState<ProjectCommitSummary | null>(null);
  const [commitBackView, setCommitBackView] = useState<"files" | "commits">(
    "commits",
  );
  const [compareBaseRef, setCompareBaseRef] = useState(project.defaultBranch);
  const [compareRef, setCompareRef] = useState(
    snapshot.checkouts[0]?.branch ?? project.defaultBranch,
  );
  const browser = useProjectBrowser(project.id, selectedRef, selectedPath);
  const commitDetail = useProjectCommit(
    project.id,
    selectedRef,
    selectedCommit?.hash,
  );

  const openCommit = (
    commit: ProjectCommitSummary,
    returnView: "files" | "commits",
  ) => {
    setSelectedCommit(commit);
    setCommitBackView(returnView);
    setView("commit");
  };

  const openCompare = (baseRef?: string, compareRef?: string) => {
    if (baseRef) setCompareBaseRef(baseRef);
    if (compareRef) setCompareRef(compareRef);
    setSelectedCommit(null);
    setView("compare");
  };

  const refresh = () => {
    onRefresh();
    browser.refresh();
  };

  const openReadmePath = useCallback((path: string) => {
    setSelectedPath(path);
    setView("files");
  }, []);

  return (
    <div className="mx-auto w-full max-w-7xl">
      <div className="flex items-start gap-3">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Back to projects"
          onClick={onBack}
        >
          <ArrowLeft size={16} />
        </Button>
        <ProjectIcon dataUrl={snapshot.iconDataUrl} className="size-11" />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[24px] leading-tight font-normal tracking-[-0.035em]">
            {project.name}
          </h2>
          <p className="text-muted-foreground mt-1 truncate text-[13px] leading-5">
            {repositoryPath ??
              project.canonicalRemoteUrl ??
              "Local-only repository on another runtime"}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={refresh}>
          <RefreshCw size={14} />
          Refresh
        </Button>
        {repositoryPath ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => void openPath(repositoryPath)}
          >
            <FolderOpen size={14} />
            Open folder
          </Button>
        ) : repositoryWebUrl ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => void openUrl(repositoryWebUrl)}
          >
            <ExternalLink size={14} />
            Open remote
          </Button>
        ) : null}
      </div>

      {!snapshot.available ? (
        <div className="border-destructive/20 bg-destructive/[0.05] text-destructive mt-5 rounded-xl border px-4 py-3 text-[13px]">
          {snapshot.error ?? "This repository is unavailable on this runtime."}
          {snapshot.portable
            ? " Chief will materialize it from its Git remote when accessed."
            : ""}
        </div>
      ) : null}

      <ProjectRepositoryToolbar
        snapshot={snapshot}
        selectedRef={selectedRef}
        onSelectRef={(ref) => {
          setSelectedRef(ref);
          setSelectedPath("");
          setSelectedCommit(null);
          setView("files");
        }}
        onOpenHistory={() => {
          setSelectedCommit(null);
          setView("commits");
        }}
        onOpenCompare={() => openCompare()}
      />

      <div
        className={cn(
          "mt-7 grid items-start gap-8",
          view === "files" && "lg:grid-cols-[minmax(0,1fr)_260px]",
        )}
      >
        <main className="min-w-0">
          {view === "compare" ? (
            <ProjectBranchCompareView
              snapshot={snapshot}
              baseRef={compareBaseRef}
              compareRef={compareRef}
              currentUser={user}
              onBaseChange={setCompareBaseRef}
              onCompareChange={setCompareRef}
              onSwap={() => {
                setCompareBaseRef(compareRef);
                setCompareRef(compareBaseRef);
              }}
              onBack={() => setView("files")}
            />
          ) : view === "commit" && selectedCommit ? (
            <Suspense fallback={<div className="min-h-40" />}>
              <ProjectCommitDetailView
                commit={selectedCommit}
                detail={commitDetail.detail}
                currentUser={user}
                loading={commitDetail.loading}
                error={commitDetail.error}
                onBack={() => setView(commitBackView)}
              />
            </Suspense>
          ) : view === "commits" ? (
            <ProjectCommitHistory
              commits={browser.browser?.commits ?? []}
              currentUser={user}
              path={selectedPath}
              onBack={() => setView("files")}
              onSelect={(commit) => openCommit(commit, "commits")}
            />
          ) : (
            <ProjectFileBrowser
              projectName={project.name}
              browser={browser.browser}
              loading={browser.loading}
              error={browser.error}
              onOpenPath={(path) => {
                setSelectedPath(path);
                setView("files");
              }}
              onOpenHistory={() => setView("commits")}
            />
          )}
          {view === "files" &&
          browser.browser?.kind === "tree" &&
          browser.browser.readme ? (
            <ProjectReadme
              readme={browser.browser.readme}
              onOpenPath={openReadmePath}
            />
          ) : null}
        </main>
        {view === "files" ? (
          <ProjectRepositorySidebar
            snapshot={snapshot}
            browser={browser.browser}
            currentUser={user}
            onSelectCommit={(commit) => openCommit(commit, "files")}
            onReviewCheckout={(branch) =>
              openCompare(project.defaultBranch, branch)
            }
          />
        ) : null}
      </div>
    </div>
  );
}
