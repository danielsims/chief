import { lazy, Suspense } from "react";
import {
  ChevronRight,
  FileCode2,
  Folder,
  History,
  Package,
} from "lucide-react";

import type {
  ProjectRepositoryBrowserSnapshot,
  ProjectTreeEntry,
} from "@chief/agent-runtime/types";
import { Skeleton } from "@chief/ui/components/skeleton";

import { formatProjectBytes, formatProjectTime } from "./project-format";

const ProjectCodeViewer = lazy(() =>
  import("./project-code-viewer").then((module) => ({
    default: module.ProjectCodeViewer,
  })),
);

function EntryIcon({ entry }: { entry: ProjectTreeEntry }) {
  if (entry.type === "directory") {
    return <Folder size={16} className="text-muted-foreground" />;
  }
  if (entry.type === "submodule") {
    return <Package size={16} className="text-muted-foreground" />;
  }
  return <FileCode2 size={16} className="text-muted-foreground" />;
}

function ProjectBreadcrumbs({
  projectName,
  path,
  onOpen,
}: {
  projectName: string;
  path: string;
  onOpen: (path: string) => void;
}) {
  const segments = path.split("/").filter(Boolean);
  return (
    <div className="flex min-w-0 items-center gap-1 text-[13px]">
      <button
        type="button"
        onClick={() => onOpen("")}
        className="hover:text-foreground text-muted-foreground shrink-0"
      >
        {projectName}
      </button>
      {segments.map((segment, index) => {
        const segmentPath = segments.slice(0, index + 1).join("/");
        return (
          <span key={segmentPath} className="flex min-w-0 items-center gap-1">
            <ChevronRight size={13} className="text-muted-foreground/70" />
            <button
              type="button"
              onClick={() => onOpen(segmentPath)}
              className="hover:text-foreground min-w-0 truncate"
            >
              {segment}
            </button>
          </span>
        );
      })}
    </div>
  );
}

function FileContent({
  browser,
  onOpenHistory,
}: {
  browser: ProjectRepositoryBrowserSnapshot;
  onOpenHistory: () => void;
}) {
  const file = browser.file;
  if (!file) return null;
  return (
    <div className="border-border/70 overflow-hidden rounded-xl border">
      {browser.latestCommit ? (
        <CommitHeader browser={browser} onOpenHistory={onOpenHistory} />
      ) : null}
      <div className="border-border/70 bg-muted/45 flex h-11 items-center justify-between border-b px-4 text-[13px]">
        <span className="truncate font-medium">
          {file.path.split("/").at(-1)}
        </span>
        <span className="text-muted-foreground shrink-0">
          {formatProjectBytes(file.size)}
        </span>
      </div>
      {file.binary ? (
        <p className="text-muted-foreground px-4 py-16 text-center text-[13px]">
          This binary file cannot be previewed.
        </p>
      ) : file.truncated ? (
        <p className="text-muted-foreground px-4 py-16 text-center text-[13px]">
          This file is too large to preview.
        </p>
      ) : (
        <Suspense
          fallback={
            <div className="space-y-3 px-4 py-5">
              {Array.from({ length: 10 }).map((_, index) => (
                <Skeleton key={index} className="h-3 w-3/4" />
              ))}
            </div>
          }
        >
          <ProjectCodeViewer path={file.path} content={file.content ?? ""} />
        </Suspense>
      )}
    </div>
  );
}

function CommitHeader({
  browser,
  onOpenHistory,
}: {
  browser: ProjectRepositoryBrowserSnapshot;
  onOpenHistory: () => void;
}) {
  const commit = browser.latestCommit;
  if (!commit) return null;
  return (
    <div className="border-border/70 bg-muted/45 flex min-h-12 items-center gap-3 border-b px-4 py-2.5 text-[13px]">
      <span className="min-w-0 flex-1 truncate">
        <span className="font-medium">{commit.authorName}</span>{" "}
        <span className="text-muted-foreground">{commit.subject}</span>
      </span>
      <span className="text-muted-foreground hidden shrink-0 xl:inline">
        {commit.shortHash} · {formatProjectTime(commit.authoredAt)}
      </span>
      <button
        type="button"
        onClick={onOpenHistory}
        className="text-muted-foreground hover:text-foreground flex shrink-0 items-center gap-1.5 transition-colors"
      >
        <History size={14} />
        History
      </button>
    </div>
  );
}

export function ProjectFileBrowser({
  projectName,
  browser,
  loading,
  error,
  onOpenPath,
  onOpenHistory,
}: {
  projectName: string;
  browser: ProjectRepositoryBrowserSnapshot | undefined;
  loading: boolean;
  error: string | null;
  onOpenPath: (path: string) => void;
  onOpenHistory: () => void;
}) {
  return (
    <section>
      <div className="mb-3 min-h-5">
        <ProjectBreadcrumbs
          projectName={projectName}
          path={browser?.path ?? ""}
          onOpen={onOpenPath}
        />
      </div>
      {error ? (
        <div className="border-destructive/25 bg-destructive/[0.05] text-destructive rounded-xl border px-4 py-4 text-[13px]">
          {error}
        </div>
      ) : loading || !browser ? (
        <div className="border-border/70 overflow-hidden rounded-xl border">
          {Array.from({ length: 8 }).map((_, index) => (
            <div
              key={index}
              className="border-border/70 flex h-12 items-center gap-3 border-b px-4 last:border-b-0"
            >
              <Skeleton className="size-4 rounded" />
              <Skeleton className="h-3.5 w-40" />
              <Skeleton className="ml-auto h-3.5 w-48" />
            </div>
          ))}
        </div>
      ) : browser.kind === "file" ? (
        <FileContent browser={browser} onOpenHistory={onOpenHistory} />
      ) : (
        <div className="border-border/70 overflow-hidden rounded-xl border">
          {browser.latestCommit ? (
            <CommitHeader browser={browser} onOpenHistory={onOpenHistory} />
          ) : null}
          {browser.entries.length === 0 ? (
            <p className="text-muted-foreground px-4 py-16 text-center text-[13px]">
              This directory is empty.
            </p>
          ) : (
            browser.entries.map((entry) => (
              <button
                type="button"
                key={entry.path}
                onClick={() => onOpenPath(entry.path)}
                className="border-border/70 hover:bg-muted/40 grid min-h-12 w-full grid-cols-[18px_minmax(150px,0.7fr)_minmax(180px,1fr)_auto] items-center gap-3 border-b px-4 text-left text-[13px] last:border-b-0"
              >
                <EntryIcon entry={entry} />
                <span className="truncate font-medium">{entry.name}</span>
                <span className="text-muted-foreground truncate">
                  {entry.lastCommit?.subject ?? ""}
                </span>
                <span className="text-muted-foreground min-w-16 text-right text-[12px]">
                  {entry.lastCommit
                    ? formatProjectTime(entry.lastCommit.authoredAt)
                    : entry.type === "file"
                      ? formatProjectBytes(entry.size)
                      : ""}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </section>
  );
}
