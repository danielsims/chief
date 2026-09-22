import { useMemo, useState } from "react";
import {
  ArrowUpRight,
  FolderOpen,
  LayoutGrid,
  List,
  RefreshCw,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import { useNavigate } from "react-router";

import type { WorkspaceFileRecord } from "@chief/agent-runtime/types";
import { Button } from "@chief/ui/components/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@chief/ui/components/select";

import {
  fileCategory,
  fileSize,
  FileTypeIcon,
} from "../components/files/file-presentation";
import { MediaPreview } from "../components/files/media-preview";
import { PageHeader } from "../components/page-header";
import { useAuth } from "../lib/auth/auth-context";
import { useWorkspaceFiles } from "../lib/runtime";

const updatedFormatter = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "short",
});
const categories = [
  "All files",
  "Documents",
  "Images",
  "Media",
  "Other",
] as const;
type Category = (typeof categories)[number];

export function WorkspaceFilesPage() {
  const { cloudOrganizationId } = useAuth();
  const { files, loading, error, refresh } =
    useWorkspaceFiles(cloudOrganizationId);
  return (
    <FilesLibrary
      files={files}
      loading={loading}
      error={error}
      onRefresh={refresh}
    />
  );
}

export function FilesLibrary({
  files,
  loading,
  error,
  onRefresh,
}: {
  files: WorkspaceFileRecord[];
  loading: boolean;
  error?: string | null;
  onRefresh?: () => void;
}) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<Category>("All files");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [sort, setSort] = useState<"recent" | "name">("recent");
  const filtered = useMemo(() => {
    const search = query.trim().toLowerCase();
    return files
      .filter(
        (file) =>
          (category === "All files" || fileCategory(file) === category) &&
          `${file.name} ${file.path} ${file.sourceAgentId ?? ""}`
            .toLowerCase()
            .includes(search),
      )
      .sort((a, b) =>
        sort === "name"
          ? a.name.localeCompare(b.name)
          : b.updatedAt - a.updatedAt,
      );
  }, [files, query, category, sort]);

  return (
    <section className="-mx-8 -mb-8 flex h-[calc(100vh-48px)] min-w-0 flex-col overflow-hidden">
      <PageHeader
        title="Files"
        description="Documents, images, and media created by your team."
        actions={
          <>
            {onRefresh ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={onRefresh}
                aria-label="Refresh files"
              >
                <RefreshCw size={14} />
              </Button>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate("/plugins")}
            >
              <SlidersHorizontal size={13} /> Connect tools
            </Button>
          </>
        }
      />
      <main className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 pb-6">
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-4 border-y py-3">
          <div className="flex flex-wrap gap-1" aria-label="File categories">
            {categories.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setCategory(item)}
                aria-pressed={category === item}
                className={`rounded-md px-3 py-1.5 text-xs transition-colors ${category === item ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted"}`}
              >
                {item}
                <span className="ml-1.5 opacity-60">
                  {item === "All files"
                    ? files.length
                    : files.filter((file) => fileCategory(file) === item)
                        .length}
                </span>
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <label className="bg-muted/40 flex h-8 items-center gap-2 rounded-md border px-2.5">
              <Search size={13} className="text-muted-foreground" />
              <input
                aria-label="Search files"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search files"
                className="w-32 bg-transparent text-xs outline-none sm:w-40"
              />
            </label>
            <Select
              value={sort}
              onValueChange={(value) =>
                setSort(value === "name" ? "name" : "recent")
              }
            >
              <SelectTrigger
                aria-label="Sort files"
                className="h-8 w-[132px] rounded-md text-[13px]"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="rounded-lg p-1">
                <SelectItem value="recent">Last updated</SelectItem>
                <SelectItem value="name">Name</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex rounded-md border p-0.5">
              <button
                type="button"
                aria-label="Grid view"
                aria-pressed={view === "grid"}
                onClick={() => setView("grid")}
                className={`rounded p-1.5 ${view === "grid" ? "bg-muted" : "text-muted-foreground"}`}
              >
                <LayoutGrid size={13} />
              </button>
              <button
                type="button"
                aria-label="List view"
                aria-pressed={view === "list"}
                onClick={() => setView("list")}
                className={`rounded p-1.5 ${view === "list" ? "bg-muted" : "text-muted-foreground"}`}
              >
                <List size={13} />
              </button>
            </div>
          </div>
        </div>
        {error ? (
          <div
            role="alert"
            className="text-destructive mt-5 rounded-lg border p-4 text-sm"
          >
            {error}
          </div>
        ) : null}
        {loading && files.length === 0 ? (
          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((index) => (
              <div
                key={index}
                className="bg-muted h-64 animate-pulse rounded-xl"
              />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center py-10 text-center">
            <FolderOpen
              size={42}
              strokeWidth={1.1}
              className="text-muted-foreground/40 mb-5"
            />
            <h2 className="text-xl tracking-tight">
              {files.length
                ? "No matching files"
                : "Your team's work lives here"}
            </h2>
            <p className="text-muted-foreground mt-2 max-w-md text-sm leading-6">
              {files.length
                ? "Try another search or file type."
                : "Ask an agent to draft a document or publish a finished image, recording, or PDF. It will be saved here for the workspace."}
            </p>
            {files.length ? (
              <Button
                variant="ghost"
                className="mt-3"
                onClick={() => {
                  setCategory("All files");
                  setQuery("");
                }}
              >
                Clear filters
              </Button>
            ) : (
              <Button
                variant="outline"
                className="mt-5"
                onClick={() => navigate("/conversations")}
              >
                Start with your team <ArrowUpRight size={13} />
              </Button>
            )}
          </div>
        ) : (
          <div
            className={
              view === "grid"
                ? "mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
                : "mt-4 divide-y rounded-xl border px-4"
            }
          >
            {filtered.map((file) => (
              <FileCard
                key={file.id}
                file={file}
                view={view}
                onOpen={() => navigate(`/files/${encodeURIComponent(file.id)}`)}
              />
            ))}
          </div>
        )}
      </main>
    </section>
  );
}

function FileCard({
  file,
  view,
  onOpen,
}: {
  file: WorkspaceFileRecord;
  view: "grid" | "list";
  onOpen: () => void;
}) {
  const source =
    file.sourceAgentId ?? (file.createdBy === "user" ? "You" : "Your team");
  return (
    <button
      type="button"
      onClick={onOpen}
      className={
        view === "grid"
          ? "group bg-card hover:border-foreground/25 overflow-hidden rounded-xl border text-left transition-colors"
          : "group hover:bg-muted/40 flex w-full items-center gap-4 py-4 text-left transition-colors"
      }
    >
      {view === "grid" ? (
        <div className="bg-muted/35 relative flex aspect-[16/9] items-center justify-center overflow-hidden border-b">
          {file.asset ? (
            <MediaPreview file={file} compact />
          ) : (
            <div className="bg-background/80 absolute bottom-0 h-40 w-36 rounded-t-lg border border-b-0 px-5 pt-5 shadow-sm">
              <FileTypeIcon
                file={file}
                size={22}
                strokeWidth={1.2}
                className="text-muted-foreground mb-4"
              />
              <span className="bg-foreground/15 block h-1.5 w-4/5 rounded-full" />
              <span className="bg-foreground/8 mt-2 block h-1 w-full rounded-full" />
              <span className="bg-foreground/8 mt-2 block h-1 w-5/6 rounded-full" />
              <span className="bg-foreground/8 mt-2 block h-1 w-3/4 rounded-full" />
            </div>
          )}
        </div>
      ) : (
        <FileTypeIcon
          file={file}
          size={20}
          strokeWidth={1.3}
          className="text-muted-foreground shrink-0"
        />
      )}
      <div className={view === "grid" ? "p-4" : "min-w-0 flex-1"}>
        <h2 className="truncate text-sm font-medium">{file.name}</h2>
        <p className="text-muted-foreground mt-1 truncate text-[11px]">
          {view === "grid" ? source : file.path}
        </p>
        <div className="text-muted-foreground mt-3 flex items-center justify-between text-[10px]">
          <span>Updated {updatedFormatter.format(file.updatedAt)}</span>
          {file.asset ? <span>{fileSize(file.asset.bytes)}</span> : null}
        </div>
      </div>
      {view === "list" ? (
        <ArrowUpRight size={14} className="text-muted-foreground" />
      ) : null}
    </button>
  );
}
