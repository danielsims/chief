import { useMemo, useState } from "react";
import { Hash, Lock, RefreshCw, Search, Table2 } from "lucide-react";
import { useNavigate } from "react-router";

import type { WorkspaceFileRecord } from "@chief/agent-runtime/types";
import type { Database } from "@chief/relay-contracts";
import { Button } from "@chief/ui/components/button";
import { cn } from "@chief/ui/lib/utils";

import { isBoard } from "../components/databases/database-model";
import {
  useDatabases,
  usePrefetchDatabase,
} from "../components/databases/use-database";
import {
  fileCategory,
  fileSize,
  FileTypeIcon,
} from "../components/files/file-presentation";
import { MediaPreview } from "../components/files/media-preview";
import { listColumnClass, ListRow } from "../components/list-row";
import { PageHeader } from "../components/page-header";
import { useAuth } from "../lib/auth/auth-context";
import { useWorkspaceFiles } from "../lib/runtime";
import { useWorkspaceChannels } from "../lib/workspace-channels-context";

const updatedFormatter = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "short",
});

const kinds = [
  "All",
  "Pages",
  "Databases",
  "Documents",
  "Images",
  "Media",
  "Other",
] as const;
type Kind = (typeof kinds)[number];

const markClass =
  "bg-foreground/[0.04] text-muted-foreground flex size-8 items-center justify-center overflow-hidden rounded-lg";

/** One thing made in the workspace, whichever kind it is. */
interface Artifact {
  key: string;
  kind: Exclude<Kind, "All">;
  name: string;
  conversationId?: string;
  updatedAt: number;
  file?: WorkspaceFileRecord;
  database?: Database;
}

/**
 * Everything your team has made, from every channel you can see: pages,
 * databases, documents and media, each marked with where it lives.
 */
export function ArtifactsPage() {
  const { cloudOrganizationId } = useAuth();
  const { files, loading, error, refresh } =
    useWorkspaceFiles(cloudOrganizationId);
  const { databases } = useDatabases();
  const { channels } = useWorkspaceChannels();
  const prefetch = usePrefetchDatabase();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<Kind>("All");

  const artifacts = useMemo<Artifact[]>(
    () =>
      [
        ...files.map((file): Artifact => ({
          key: `file:${file.id}`,
          kind: fileCategory(file),
          name: file.name,
          conversationId: file.sourceConversationId,
          updatedAt: file.updatedAt,
          file,
        })),
        ...databases
          .filter((database) => !isBoard(database))
          .map((database): Artifact => ({
            key: `database:${database.id}`,
            kind: "Databases",
            name: database.name,
            conversationId: database.conversationId,
            updatedAt: database.updatedAt,
            database,
          })),
      ].sort((left, right) => right.updatedAt - left.updatedAt),
    [files, databases],
  );
  const search = query.trim().toLowerCase();
  const shown = artifacts.filter(
    (artifact) =>
      (kind === "All" || artifact.kind === kind) &&
      artifact.name.toLowerCase().includes(search),
  );

  const channelOf = (conversationId?: string) =>
    channels.find((channel) => channel.id === conversationId);
  const open = (artifact: Artifact) => {
    const { file, database } = artifact;
    if (file) void navigate(`/artifacts/${encodeURIComponent(file.id)}`);
    if (!database) return;
    if (database.conversationId)
      void navigate(
        `/conversations?${new URLSearchParams({ channel: database.conversationId, view: "artifacts", database: database.id })}`,
      );
    else
      void navigate(`/artifacts/databases/${encodeURIComponent(database.id)}`);
  };

  return (
    <section className="-mx-8 -mb-8 flex h-[calc(100vh-48px)] min-w-0 flex-col overflow-hidden">
      <PageHeader
        title="Artifacts"
        description="Everything your team has made, across your channels."
        actions={
          <>
            <label className="bg-background flex h-8 items-center gap-2 rounded-lg px-2.5 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_10%,transparent)]">
              <Search size={13} className="text-muted-foreground" />
              <input
                aria-label="Search artifacts"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search"
                className="w-32 bg-transparent text-xs outline-none sm:w-40"
              />
            </label>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={refresh}
              aria-label="Refresh artifacts"
            >
              <RefreshCw size={14} />
            </Button>
          </>
        }
      />
      <main className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 pb-6">
        <div className={cn(listColumnClass, "flex flex-1 flex-col")}>
          <div className="mb-3 flex flex-wrap gap-1" aria-label="Kinds">
            {kinds.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setKind(item)}
                aria-pressed={kind === item}
                className={cn(
                  "text-muted-foreground hover:text-foreground h-7 rounded-full px-3 text-[12px] transition-colors",
                  kind === item && "bg-foreground/[0.06] text-foreground",
                )}
              >
                {item}
              </button>
            ))}
          </div>
          {error ? (
            <p role="alert" className="text-destructive py-2 text-sm">
              {error}
            </p>
          ) : null}
          {loading && artifacts.length === 0 ? (
            [0, 1, 2, 3].map((index) => (
              <div
                key={index}
                className="bg-muted/60 my-1 h-12 animate-pulse rounded-lg"
              />
            ))
          ) : shown.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center pb-16 text-center">
              <p className="text-[15px] font-medium tracking-[-0.01em]">
                {artifacts.length ? "Nothing matches" : "Nothing made yet"}
              </p>
              <p className="text-muted-foreground mt-1 max-w-sm text-[13px] leading-5">
                {artifacts.length
                  ? "Try another search or kind."
                  : "Pages, databases and documents your team makes appear here."}
              </p>
            </div>
          ) : (
            <ul>
              {shown.map((artifact) => {
                const channel = channelOf(artifact.conversationId);
                const { file, database } = artifact;
                return (
                  <ListRow
                    key={artifact.key}
                    onClick={() => open(artifact)}
                    onHover={database ? () => prefetch(database.id) : undefined}
                    leading={
                      <span className={markClass}>
                        {file?.asset ? (
                          <MediaPreview file={file} compact />
                        ) : file ? (
                          <FileTypeIcon
                            file={file}
                            size={15}
                            strokeWidth={1.5}
                          />
                        ) : (
                          <Table2 size={15} strokeWidth={1.5} />
                        )}
                      </span>
                    }
                    title={artifact.name}
                    subtitle={
                      file?.asset
                        ? `${artifact.kind.replace(/s$/u, "")} · ${fileSize(file.asset.bytes)}`
                        : artifact.kind.replace(/s$/u, "")
                    }
                    trailing={
                      <>
                        <span className="bg-foreground/[0.05] text-muted-foreground flex max-w-36 shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px]">
                          {channel ? (
                            <>
                              {channel.visibility === "private" ? (
                                <Lock size={10} className="shrink-0" />
                              ) : (
                                <Hash size={10} className="shrink-0" />
                              )}
                              <span className="truncate">{channel.name}</span>
                            </>
                          ) : (
                            "Workspace"
                          )}
                        </span>
                        <span className="text-muted-foreground w-14 shrink-0 text-right text-[12px]">
                          {updatedFormatter.format(artifact.updatedAt)}
                        </span>
                      </>
                    }
                  />
                );
              })}
            </ul>
          )}
        </div>
      </main>
    </section>
  );
}
