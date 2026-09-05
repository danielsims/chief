import type { ReactNode } from "react";
import { useState } from "react";
import { ArrowUpRight, LayoutGrid, List, RefreshCw } from "lucide-react";
import { useSearchParams } from "react-router";

import { Button } from "@chief/ui/components/button";

import { useAuth } from "../../lib/auth/auth-context";
import { useWorkspaceFiles } from "../../lib/runtime";
import { artifactDocument } from "../files/artifact-content";
import { FileTypeIcon } from "../files/file-presentation";
import { MediaPreview } from "../files/media-preview";
import { ChannelArtifactViewer } from "./channel-artifact-viewer";
import { StreamingMarkdown } from "./streaming-markdown";

export function ChannelCanvas({
  channelName,
  conversationId,
  children,
}: {
  channelName: string;
  conversationId: string;
  children?: ReactNode;
}) {
  const { cloudOrganizationId } = useAuth();
  const { files, loading, error, refresh } =
    useWorkspaceFiles(cloudOrganizationId);
  const [params, setParams] = useSearchParams();
  const [layout, setLayout] = useState<"list" | "grid">("list");
  const selected = params.get("artifact");
  const channelFiles = files
    .filter((file) => file.sourceConversationId === conversationId)
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const select = (id: string | null) =>
    setParams((current) => {
      const next = new URLSearchParams(current);
      if (id) next.set("artifact", id);
      else next.delete("artifact");
      return next;
    });
  if (selected)
    return (
      <ChannelArtifactViewer
        key={selected}
        fileId={selected}
        conversationId={conversationId}
        onBack={() => select(null)}
      />
    );
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex min-h-full w-full max-w-5xl flex-col px-6 py-6">
        {children}
        {error ? (
          <div role="alert" className="flex items-center gap-3 text-sm">
            <p>{error}</p>
            <Button variant="outline" size="sm" onClick={refresh}>
              Try again
            </Button>
          </div>
        ) : loading && !channelFiles.length ? (
          <p className="text-muted-foreground py-16 text-center text-sm">
            Loading Canvas…
          </p>
        ) : !channelFiles.length ? (
          <div className="flex min-h-64 flex-1 flex-col items-center justify-center gap-2 pb-12 text-center">
            <h2 className="text-lg font-medium tracking-tight">
              A place for the work
            </h2>
            <p className="text-muted-foreground max-w-sm text-sm leading-6">
              Documents, tools and ideas your team creates in #{channelName}{" "}
              will live here.
            </p>
          </div>
        ) : (
          <>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-medium">Artifacts</h2>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Refresh artifacts"
                  onClick={refresh}
                >
                  <RefreshCw size={14} />
                </Button>
                <Button
                  variant={layout === "list" ? "secondary" : "ghost"}
                  size="icon-sm"
                  aria-label="List view"
                  onClick={() => setLayout("list")}
                >
                  <List size={15} />
                </Button>
                <Button
                  variant={layout === "grid" ? "secondary" : "ghost"}
                  size="icon-sm"
                  aria-label="Grid view"
                  onClick={() => setLayout("grid")}
                >
                  <LayoutGrid size={15} />
                </Button>
              </div>
            </div>
            <div
              className={
                layout === "grid"
                  ? "grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
                  : "divide-border/60 divide-y border-y"
              }
            >
              {channelFiles.map((file) => (
                <button
                  key={file.id}
                  type="button"
                  onClick={() => select(file.id)}
                  className={
                    layout === "grid"
                      ? "bg-card hover:border-foreground/25 overflow-hidden rounded-lg border text-left transition-colors"
                      : "hover:bg-muted/25 flex w-full items-center gap-4 px-3 py-4 text-left transition-colors"
                  }
                >
                  <div
                    className={
                      layout === "grid"
                        ? "bg-muted/20 flex aspect-[16/10] items-center justify-center overflow-hidden border-b"
                        : "bg-muted/30 flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md"
                    }
                  >
                    {file.asset ? (
                      <MediaPreview file={file} compact />
                    ) : layout === "grid" && file.previewContent ? (
                      file.mimeType === "text/html" ? (
                        <div
                          className="pointer-events-none relative size-full overflow-hidden"
                          aria-hidden
                        >
                          <iframe
                            tabIndex={-1}
                            title={`${file.name} preview`}
                            sandbox=""
                            referrerPolicy="no-referrer"
                            srcDoc={artifactDocument(file.previewContent)}
                            className="pointer-events-none absolute top-0 left-0 h-[200%] w-[200%] origin-top-left scale-50 border-0"
                          />
                        </div>
                      ) : (
                        <div
                          aria-hidden
                          className="pointer-events-none h-full w-full overflow-hidden px-5 pt-5 text-sm opacity-70"
                        >
                          <StreamingMarkdown>
                            {file.previewContent}
                          </StreamingMarkdown>
                        </div>
                      )
                    ) : (
                      <FileTypeIcon
                        file={file}
                        size={layout === "grid" ? 34 : 20}
                        strokeWidth={1.3}
                        className="text-muted-foreground"
                      />
                    )}
                  </div>
                  <div
                    className={
                      layout === "grid"
                        ? "flex items-center gap-3 p-4"
                        : "flex min-w-0 flex-1 items-center gap-3"
                    }
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {file.name}
                      </span>
                      <span className="text-muted-foreground mt-1 block text-sm">
                        {file.mimeType === "text/html"
                          ? "Interactive"
                          : file.mimeType === "text/csv"
                            ? "Spreadsheet"
                            : file.asset
                              ? "Media"
                              : "Document"}
                      </span>
                    </span>
                    <ArrowUpRight
                      size={14}
                      className="text-muted-foreground shrink-0"
                    />
                  </div>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
