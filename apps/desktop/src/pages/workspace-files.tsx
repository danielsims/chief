import { useMemo } from "react";
import { FileText, Mail, MoveUpRight } from "lucide-react";
import { useNavigate } from "react-router";

import { useAuth } from "../lib/auth/auth-context";
import { useWorkspaceFiles } from "../lib/runtime";

const updatedFormatter = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
});

export function WorkspaceFilesPage() {
  const navigate = useNavigate();
  const { cloudOrganizationId } = useAuth();
  const { files, loading } = useWorkspaceFiles(cloudOrganizationId);
  const sortedFiles = useMemo(
    () => [...files].sort((a, b) => b.updatedAt - a.updatedAt),
    [files],
  );

  return (
    <section className="mx-auto max-w-6xl pt-8 pb-20">
      <header className="border-b pb-8">
        <h1 className="font-serif text-4xl">Files</h1>
        <p className="text-muted-foreground mt-2 max-w-xl text-sm leading-6">
          Documents your agents have created for this workspace. Open one to
          edit it, preview it, or continue the work with an agent.
        </p>
      </header>

      {loading && sortedFiles.length === 0 ? (
        <div className="mt-8 space-y-2">
          {Array.from({ length: 3 }).map((_, index) => (
            <div
              key={index}
              className="bg-card h-[76px] animate-pulse border"
            />
          ))}
        </div>
      ) : sortedFiles.length === 0 ? (
        <div className="mt-8 border px-8 py-16 text-center">
          <p className="font-serif text-2xl">No files yet</p>
          <p className="text-muted-foreground mx-auto mt-2 max-w-md text-sm leading-6">
            When an agent drafts a document or email, it will appear here as an
            editable file.
          </p>
        </div>
      ) : (
        <div className="mt-8 border">
          {sortedFiles.map((file, index) => {
            const Icon = file.kind === "email" ? Mail : FileText;
            return (
              <button
                key={file.id}
                type="button"
                onClick={() =>
                  navigate(`/files/${encodeURIComponent(file.id)}`)
                }
                className={`hover:bg-accent/60 group flex w-full items-center gap-4 px-5 py-4 text-left transition-colors ${index > 0 ? "border-t" : ""}`}
              >
                <span className="bg-card flex size-9 shrink-0 items-center justify-center border">
                  <Icon size={15} strokeWidth={1.6} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {file.name}
                  </span>
                  <span className="text-muted-foreground mt-1 block truncate font-mono text-[10px]">
                    {file.path}
                  </span>
                </span>
                <span className="text-muted-foreground shrink-0 text-[11px]">
                  {updatedFormatter.format(file.updatedAt)}
                </span>
                <MoveUpRight
                  size={14}
                  className="text-muted-foreground group-hover:text-foreground shrink-0 transition-colors"
                />
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
