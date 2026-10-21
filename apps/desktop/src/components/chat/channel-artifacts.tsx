import { useState } from "react";
import { Plus, Table2 } from "lucide-react";
import { useSearchParams } from "react-router";

import { Button } from "@chief/ui/components/button";
import { cn } from "@chief/ui/lib/utils";

import { useAuth } from "../../lib/auth/auth-context";
import { useWorkspaceFiles } from "../../lib/runtime";
import { DatabaseCreateDialog } from "../databases/database-create-dialog";
import { isBoard } from "../databases/database-model";
import {
  announceDatabasesChanged,
  useDatabases,
  usePrefetchDatabase,
} from "../databases/use-database";
import { fileCategory, FileTypeIcon } from "../files/file-presentation";
import { MediaPreview } from "../files/media-preview";
import { listColumnClass, ListRow } from "../list-row";
import { ChannelArtifactViewer } from "./channel-artifact-viewer";
import { ChannelDatabaseViewer } from "./channel-database-viewer";

const updated = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "short",
});

const markClass =
  "bg-foreground/[0.04] text-muted-foreground flex size-8 items-center justify-center overflow-hidden rounded-lg";

/**
 * What a channel's people and agents have made: documents, pages, media and
 * databases, opened in place and kept as tabs.
 */
export function ChannelArtifacts({
  channelName,
  conversationId,
}: {
  channelName: string;
  conversationId: string;
}) {
  const { cloudOrganizationId } = useAuth();
  const { files, loading, error, refresh } =
    useWorkspaceFiles(cloudOrganizationId);
  const { databases } = useDatabases(conversationId);
  const prefetch = usePrefetchDatabase();
  const [params, setParams] = useSearchParams();
  const [creating, setCreating] = useState(false);
  const selected = params.get("artifact");
  const selectedDatabase = params.get("database");
  const select = (key: "artifact" | "database", id: string | null) =>
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.delete("artifact");
      next.delete("database");
      if (id) next.set(key, id);
      return next;
    });
  if (selected)
    return (
      <ChannelArtifactViewer
        key={selected}
        fileId={selected}
        conversationId={conversationId}
        onBack={() => select("artifact", null)}
      />
    );
  if (selectedDatabase)
    return (
      <ChannelDatabaseViewer
        key={selectedDatabase}
        databaseId={selectedDatabase}
        conversationId={conversationId}
        onClosed={() => select("database", null)}
      />
    );

  // Newest first, whatever kind they are.
  const artifacts = [
    ...databases
      .filter((database) => !isBoard(database))
      .map((database) => ({
        key: `database:${database.id}`,
        updatedAt: database.updatedAt,
        row: (
          <ListRow
            key={`database:${database.id}`}
            onClick={() => select("database", database.id)}
            onHover={() => prefetch(database.id)}
            leading={
              <span className={markClass}>
                <Table2 size={15} strokeWidth={1.5} />
              </span>
            }
            title={database.name}
            subtitle="Database"
            trailing={<When at={database.updatedAt} />}
          />
        ),
      })),
    ...files
      .filter((file) => file.sourceConversationId === conversationId)
      .map((file) => ({
        key: `file:${file.id}`,
        updatedAt: file.updatedAt,
        row: (
          <ListRow
            key={`file:${file.id}`}
            onClick={() => select("artifact", file.id)}
            leading={
              <span className={markClass}>
                {file.asset ? (
                  <MediaPreview file={file} compact />
                ) : (
                  <FileTypeIcon file={file} size={15} strokeWidth={1.5} />
                )}
              </span>
            }
            title={file.name}
            subtitle={
              fileCategory(file) === "Pages"
                ? "Page"
                : file.mimeType === "text/csv"
                  ? "Spreadsheet"
                  : file.asset
                    ? "Media"
                    : "Document"
            }
            trailing={<When at={file.updatedAt} />}
          />
        ),
      })),
  ].sort((left, right) => right.updatedAt - left.updatedAt);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 pb-8">
      <div className={cn(listColumnClass, "flex flex-1 flex-col")}>
        {error ? (
          <div role="alert" className="flex items-center gap-3 py-2 text-sm">
            <p>{error}</p>
            <Button variant="outline" size="sm" onClick={refresh}>
              Try again
            </Button>
          </div>
        ) : null}
        {loading && !artifacts.length ? (
          [0, 1, 2].map((index) => (
            <div
              key={index}
              className="bg-muted/60 my-1 h-12 animate-pulse rounded-lg"
            />
          ))
        ) : !artifacts.length ? (
          <div className="flex flex-1 flex-col items-center justify-center pb-16 text-center">
            <p className="text-[15px] font-medium tracking-[-0.01em]">
              Nothing here yet
            </p>
            <p className="text-muted-foreground mt-1 max-w-sm text-[13px] leading-5">
              Documents, pages and databases made in #{channelName} live here.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-5"
              onClick={() => setCreating(true)}
            >
              <Plus size={14} />
              New database
            </Button>
          </div>
        ) : (
          <>
            <div className="mb-2 flex justify-end">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setCreating(true)}
              >
                <Plus size={14} />
                New database
              </Button>
            </div>
            <ul>{artifacts.map((artifact) => artifact.row)}</ul>
          </>
        )}
      </div>
      {creating ? (
        <DatabaseCreateDialog
          conversationId={conversationId}
          onClose={() => setCreating(false)}
          onCreated={(database) => {
            setCreating(false);
            announceDatabasesChanged();
            select("database", database.id);
          }}
        />
      ) : null}
    </div>
  );
}

function When({ at }: { at: number }) {
  return (
    <span className="text-muted-foreground w-16 shrink-0 text-right text-[12px]">
      {updated.format(at)}
    </span>
  );
}
