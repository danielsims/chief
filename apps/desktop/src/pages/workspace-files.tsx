import { useMemo } from "react";
import { FileText, Mail, MoveUpRight } from "lucide-react";
import { useNavigate } from "react-router";

import { PageTitle } from "../components/page-title";
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
    <section className="-mx-8 -mb-8 flex h-[calc(100vh-48px)] min-w-0 flex-col overflow-hidden">
      <header className="shrink-0 border-b border-black/[0.055] px-6 pt-5 pb-4 dark:border-white/[0.055]">
        <PageTitle>Files</PageTitle>
        <p className="text-muted-foreground mt-1 max-w-xl text-[13px] leading-5">
          Documents your agents have created for this workspace. Open one to
          edit it, preview it, or continue the work with an agent.
        </p>
      </header>

      <div className="min-h-0 flex-1 [scrollbar-width:thin] overflow-y-auto px-6 py-6">
        <div className="mx-auto w-full max-w-6xl">
          {loading && sortedFiles.length === 0 ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, index) => (
                <div
                  key={index}
                  className="bg-muted h-[72px] animate-pulse rounded-2xl shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_6%,transparent)]"
                />
              ))}
            </div>
          ) : sortedFiles.length === 0 ? (
            <div className="bg-muted flex min-h-64 flex-col items-center justify-center rounded-2xl px-8 py-16 text-center shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_7%,transparent),0_1px_2px_rgba(0,0,0,0.025)]">
              <p className="text-[22px] leading-tight font-normal tracking-[-0.035em]">
                No files yet
              </p>
              <p className="text-muted-foreground mt-2 max-w-md text-[12px] leading-5">
                When an agent drafts a document or email, it will appear here as
                an editable file.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {sortedFiles.map((file) => {
                const Icon = file.kind === "email" ? Mail : FileText;
                return (
                  <button
                    key={file.id}
                    type="button"
                    onClick={() =>
                      navigate(`/files/${encodeURIComponent(file.id)}`)
                    }
                    className="bg-muted hover:bg-accent/70 group flex min-h-[68px] w-full items-center gap-3.5 rounded-2xl px-4 py-3 text-left shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_7%,transparent),0_1px_2px_rgba(0,0,0,0.025)] transition-[background-color,box-shadow]"
                  >
                    <Icon
                      size={16}
                      strokeWidth={1.7}
                      className="text-muted-foreground shrink-0"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium">
                        {file.name}
                      </span>
                      <span className="text-muted-foreground mt-0.5 block truncate font-mono text-[10px]">
                        {file.path}
                      </span>
                    </span>
                    <span className="text-muted-foreground shrink-0 text-[10px] tabular-nums">
                      {updatedFormatter.format(file.updatedAt)}
                    </span>
                    <MoveUpRight
                      size={13}
                      className="text-muted-foreground/60 group-hover:text-foreground shrink-0 transition-[color,transform] group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
                    />
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
