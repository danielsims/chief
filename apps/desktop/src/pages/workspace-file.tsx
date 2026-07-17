import { useState } from "react";
import {
  ArrowLeft,
  Eye,
  FileText,
  Mail,
  MessageSquare,
  Pencil,
} from "lucide-react";
import { useNavigate, useParams } from "react-router";

import type { WorkspaceFileSnapshot } from "@chief/agent-runtime/types";
import { Button } from "@chief/ui/components/button";

import { DocumentEditor } from "../components/files/document-editor";
import { useAuth } from "../lib/auth/auth-context";
import { createChat } from "../lib/chat-log";
import { useWorkspaceEmailPreview, useWorkspaceFile } from "../lib/runtime";

export function WorkspaceFilePage() {
  const navigate = useNavigate();
  const { fileId } = useParams();
  const { cloudOrganizationId } = useAuth();
  const { file, loading, saving, error, save } = useWorkspaceFile(
    cloudOrganizationId,
    fileId ?? null,
  );

  if (loading && !file) {
    return (
      <div className="mx-auto max-w-4xl py-16">
        <div className="bg-card h-10 w-72 animate-pulse border" />
        <div className="bg-card mt-8 h-[520px] animate-pulse border" />
      </div>
    );
  }

  if (!file) {
    return (
      <div className="mx-auto max-w-xl py-24 text-center">
        <p className="font-serif text-2xl">This file is unavailable</p>
        <p className="text-muted-foreground mt-2 text-sm">
          It may have been removed or belongs to another workspace.
        </p>
        <Button variant="outline" className="mt-6" onClick={() => navigate(-1)}>
          Go back
        </Button>
      </div>
    );
  }

  return (
    <WorkspaceFileEditor
      key={`${file.id}:${file.currentVersionId}`}
      file={file}
      workspaceId={cloudOrganizationId}
      saving={saving}
      error={error}
      save={save}
    />
  );
}

function WorkspaceFileEditor({
  file,
  workspaceId,
  saving,
  error,
  save,
}: {
  file: WorkspaceFileSnapshot;
  workspaceId: string | null;
  saving: boolean;
  error: string | null;
  save: (content: string, name?: string) => void;
}) {
  const navigate = useNavigate();
  const [name, setName] = useState(file.name);
  const [content, setContent] = useState(file.content);
  const [view, setView] = useState<"edit" | "preview">("edit");
  const emailPreview = useWorkspaceEmailPreview(workspaceId, file);
  const dirty = name.trim() !== file.name || content !== file.content;
  const continueWithAgent = () => {
    if (dirty || saving) return;
    const chat = createChat(`Continue ${file.name}`);
    const draft = [
      `Continue working from the saved workspace file \`${file.path}\`.`,
      `Use file id \`${file.id}\` at revision \`${file.currentVersionId}\` as the source of truth.`,
      file.sourceAgentId
        ? `Consult the ${file.sourceAgentId} specialist if useful.`
        : "Consult the right specialist if useful.",
      "Read it before making changes and save any revision back to the same file.",
    ].join(" ");
    void navigate(
      `/conversations?chat=${encodeURIComponent(chat.id)}&draft=${encodeURIComponent(draft)}`,
    );
  };

  const KindIcon = file.kind === "email" ? Mail : FileText;

  return (
    <section className="mx-auto max-w-5xl pb-20">
      <header className="bg-background/95 sticky top-0 z-20 -mx-2 flex min-h-14 items-center gap-3 px-2 backdrop-blur">
        <button
          type="button"
          aria-label="Go back"
          className="text-muted-foreground hover:text-foreground flex size-8 items-center justify-center"
          onClick={() => navigate(-1)}
        >
          <ArrowLeft size={16} />
        </button>
        <KindIcon size={15} className="text-muted-foreground shrink-0" />
        <div className="min-w-0 flex-1">
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="w-full bg-transparent text-sm font-medium outline-none"
            aria-label="File name"
          />
          <p className="text-muted-foreground truncate font-mono text-[10px]">
            {file.path}
          </p>
        </div>
        <span className="text-muted-foreground text-[11px]">
          {error
            ? "Not saved"
            : saving
              ? "Saving..."
              : dirty
                ? "Unsaved changes"
                : "Saved locally"}
        </span>
        {file.kind === "email" ? (
          <div className="flex border p-0.5">
            <button
              type="button"
              className={`flex h-7 items-center gap-1.5 px-2 text-[11px] ${view === "edit" ? "bg-accent text-foreground" : "text-muted-foreground"}`}
              onClick={() => setView("edit")}
            >
              <Pencil size={11} /> Edit
            </button>
            <button
              type="button"
              className={`flex h-7 items-center gap-1.5 px-2 text-[11px] ${view === "preview" ? "bg-accent text-foreground" : "text-muted-foreground"}`}
              onClick={() => setView("preview")}
            >
              <Eye size={11} /> Preview
            </button>
          </div>
        ) : null}
        <Button
          variant="outline"
          size="sm"
          disabled={!dirty || saving}
          onClick={() => save(content, name)}
        >
          Save
        </Button>
        <Button
          size="sm"
          disabled={dirty || saving}
          onClick={continueWithAgent}
        >
          <MessageSquare size={13} />
          Continue with agent
        </Button>
      </header>

      {error ? (
        <div className="border-destructive/40 bg-destructive/5 text-destructive mt-3 border px-4 py-3 text-xs">
          {error}
        </div>
      ) : null}

      {view === "preview" && file.kind === "email" ? (
        <div className="bg-card/20 mt-5 border p-4">
          {dirty ? (
            <div className="text-muted-foreground border-b px-3 pb-3 text-xs">
              Save your changes to refresh this preview.
            </div>
          ) : null}
          {emailPreview.loading ? (
            <div className="bg-card mx-auto my-10 h-[620px] max-w-2xl animate-pulse border" />
          ) : emailPreview.error ? (
            <div className="text-destructive px-4 py-12 text-center text-sm">
              {emailPreview.error}
            </div>
          ) : emailPreview.preview ? (
            <iframe
              title={`Preview of ${file.name}`}
              srcDoc={emailPreview.preview.html}
              sandbox=""
              referrerPolicy="no-referrer"
              className="mx-auto h-[720px] w-full max-w-3xl border bg-white"
            />
          ) : null}
        </div>
      ) : (
        <div className="bg-card/20 mt-5 border px-14 py-12">
          <DocumentEditor value={content} onChange={setContent} />
        </div>
      )}
    </section>
  );
}
