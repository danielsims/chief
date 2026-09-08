import { useState } from "react";
import { ArrowLeft, Copy, Download, MessageSquare, Pencil } from "lucide-react";
import { useNavigate } from "react-router";

import { channelArtifactPath } from "@chief/relay-contracts";
import { Button } from "@chief/ui/components/button";

import { useAuth } from "../../lib/auth/auth-context";
import { useWorkspaceFile } from "../../lib/runtime";
import { ArtifactContent } from "../files/artifact-content";
import { downloadFileBlob, fileDownloadName } from "../files/file-presentation";

export function ChannelArtifactViewer({
  fileId,
  conversationId,
  onBack,
}: {
  fileId: string;
  conversationId: string;
  onBack: () => void;
}) {
  const { cloudOrganizationId } = useAuth();
  const { file, loading, saving, error, save } = useWorkspaceFile(
    cloudOrganizationId,
    fileId,
  );
  const navigate = useNavigate();
  const [draft, setDraft] = useState<{
    content: string;
    version: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);
  const available = file?.sourceConversationId === conversationId;
  const changed = draft && file && draft.version !== file.currentVersionId;
  if (changed && file.content === draft.content && !saving) setDraft(null);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-border/60 flex min-h-14 shrink-0 items-center gap-3 border-b px-5">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Back to Canvas"
          onClick={onBack}
        >
          <ArrowLeft size={16} />
        </Button>
        <h2 className="min-w-0 flex-1 truncate text-sm font-medium">
          {available ? file.name : "Canvas"}
        </h2>
        {available && (
          <>
            {!file.asset && (
              <Button
                variant="ghost"
                size="icon-sm"
                title="Edit artifact"
                aria-label="Edit artifact"
                onClick={() =>
                  setDraft({
                    content: file.content,
                    version: file.currentVersionId,
                  })
                }
              >
                <Pencil size={15} />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon-sm"
              title={copied ? "Link copied" : "Copy link"}
              aria-label="Copy artifact link"
              onClick={() => {
                void navigator.clipboard
                  .writeText(
                    new URL(
                      channelArtifactPath(conversationId, fileId),
                      window.location.origin,
                    ).href,
                  )
                  .then(() => setCopied(true));
              }}
            >
              <Copy size={15} />
            </Button>
            {!file.asset && (
              <Button
                variant="ghost"
                size="icon-sm"
                title="Download"
                aria-label="Download artifact"
                onClick={() =>
                  downloadFileBlob(
                    new Blob([file.content], { type: file.mimeType }),
                    fileDownloadName(file),
                  )
                }
              >
                <Download size={15} />
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                navigate(
                  `/conversations?${new URLSearchParams({ channel: conversationId, draft: `Read artifact “${file.name}” (file ID ${file.id}, version ${file.currentVersionId}) and help me improve it.` })}`,
                )
              }
            >
              <MessageSquare size={14} />
              Discuss
            </Button>
          </>
        )}
      </div>
      {error && (
        <p role="alert" className="text-destructive px-6 py-3 text-sm">
          {error}
        </p>
      )}
      {loading && !file ? (
        <div className="text-muted-foreground grid flex-1 place-items-center text-sm">
          Loading artifact…
        </div>
      ) : !available ? (
        <div className="text-muted-foreground grid flex-1 place-items-center px-6 text-center text-sm">
          This artifact isn’t available in this channel.
        </div>
      ) : draft ? (
        <div className="flex min-h-0 flex-1 flex-col gap-4 p-6">
          <textarea
            aria-label="Artifact source"
            className="bg-muted/20 min-h-80 flex-1 resize-none rounded-md border p-4 font-mono text-sm leading-6 outline-none"
            value={draft.content}
            onChange={(event) =>
              setDraft({ ...draft, content: event.target.value })
            }
          />
          {changed && (
            <p role="alert" className="text-destructive text-sm">
              A newer version is available. Close this edit and reopen it before
              saving.
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              disabled={saving}
              onClick={() => setDraft(null)}
            >
              Close edit
            </Button>
            <Button
              disabled={saving || Boolean(changed)}
              onClick={() => save(draft.content)}
            >
              {saving ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <ArtifactContent file={file} />
        </div>
      )}
    </div>
  );
}
