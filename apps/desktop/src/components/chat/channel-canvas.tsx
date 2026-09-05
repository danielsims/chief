import type { ReactNode } from "react";
import { ArrowUpRight, FileText } from "lucide-react";
import { useNavigate } from "react-router";

import { useAuth } from "../../lib/auth/auth-context";
import { useWorkspaceFiles } from "../../lib/runtime";
import { fileSize, FileTypeIcon } from "../files/file-presentation";
import { MediaPreview } from "../files/media-preview";

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
  const { files, loading } = useWorkspaceFiles(cloudOrganizationId);
  const navigate = useNavigate();
  const channelFiles = files
    .filter((file) => file.sourceConversationId === conversationId)
    .sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-4xl space-y-8 px-6 py-8">
        {children}
        <section>
          <header>
            <h2 className="text-xl font-normal tracking-tight">
              Files and reports
            </h2>
            <p className="text-muted-foreground mt-1.5 text-xs leading-5">
              Work published in #{channelName}, ready to read, download, and
              build on.
            </p>
          </header>
          {channelFiles.length ? (
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              {channelFiles.map((file) => {
                return (
                  <button
                    key={file.id}
                    type="button"
                    onClick={() =>
                      navigate(`/files/${encodeURIComponent(file.id)}`)
                    }
                    className="bg-card hover:border-foreground/25 overflow-hidden rounded-xl border text-left transition-colors"
                  >
                    <div className="bg-muted/30 flex aspect-[16/9] items-center justify-center overflow-hidden border-b">
                      {file.asset ? (
                        <MediaPreview file={file} compact />
                      ) : (
                        <FileTypeIcon
                          file={file}
                          size={42}
                          strokeWidth={1.1}
                          className="text-muted-foreground/40"
                        />
                      )}
                    </div>
                    <div className="flex items-center gap-3 p-4">
                      <div className="min-w-0 flex-1">
                        <h3 className="truncate text-sm font-medium">
                          {file.name}
                        </h3>
                        <p className="text-muted-foreground mt-1 text-[11px]">
                          {file.sourceAgentId ?? "Your team"}
                          {file.asset ? ` · ${fileSize(file.asset.bytes)}` : ""}
                        </p>
                      </div>
                      <ArrowUpRight
                        size={13}
                        className="text-muted-foreground"
                      />
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="text-muted-foreground mt-5 flex min-h-36 flex-col items-center justify-center gap-3 rounded-xl border border-dashed px-6 text-center text-xs leading-5">
              <FileText size={24} strokeWidth={1.2} />
              {loading
                ? "Loading files…"
                : "Ask your team to publish a report, chart, or finished file in this channel."}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
