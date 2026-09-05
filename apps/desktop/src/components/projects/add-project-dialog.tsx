import { useEffect, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { FolderGit2 } from "lucide-react";

import { isJsonString } from "@chief/relay-contracts";
import { Button } from "@chief/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@chief/ui/components/dialog";
import { cn } from "@chief/ui/lib/utils";

import { useProjects } from "../../lib/runtime-projects";

type ProjectSource = "attach" | "clone";

export function AddProjectDialog({
  open: visible,
  onOpenChange,
  initialRemoteUrl,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialRemoteUrl?: string;
}) {
  const projects = useProjects();
  const { clearError } = projects;
  const [source, setSource] = useState<ProjectSource>(
    initialRemoteUrl ? "clone" : "attach",
  );
  const [path, setPath] = useState("");
  const [remoteUrl, setRemoteUrl] = useState(initialRemoteUrl ?? "");

  useEffect(() => {
    if (!visible) return;
    clearError();
    if (initialRemoteUrl) {
      setSource("clone");
      setRemoteUrl(initialRemoteUrl);
    }
  }, [clearError, initialRemoteUrl, visible]);

  const chooseFolder = async () => {
    if (!isTauri()) return;
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Choose a Git repository",
    });
    if (isJsonString(selected)) setPath(selected);
  };

  const submit = async () => {
    try {
      if (source === "attach") await projects.attach(path);
      else await projects.clone(remoteUrl);
      setPath("");
      setRemoteUrl("");
      onOpenChange(false);
    } catch {
      // The hook keeps a user-facing error in the dialog.
    }
  };

  return (
    <Dialog open={visible} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[440px] gap-0 overflow-hidden p-0">
        <DialogHeader className="px-5 pt-5 pb-4">
          <DialogTitle>Add a project</DialogTitle>
          <DialogDescription>
            Connect a repository for agents running on this Mac.
          </DialogDescription>
        </DialogHeader>

        <div className="px-5 pb-5">
          <div className="bg-muted grid grid-cols-2 rounded-lg p-0.5">
            {(
              [
                ["attach", "On this Mac"],
                ["clone", "Git URL"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => {
                  setSource(value);
                  projects.clearError();
                }}
                className={cn(
                  "text-muted-foreground flex h-8 items-center justify-center rounded-md text-[12px] transition-[background-color,box-shadow,color]",
                  source === value &&
                    "bg-background text-foreground shadow-[0_1px_2px_rgba(0,0,0,0.08),inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_7%,transparent)]",
                )}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="mt-4 min-h-11">
            {source === "attach" ? (
              isTauri() ? (
                <button
                  type="button"
                  onClick={() => void chooseFolder()}
                  className="border-border bg-muted/60 hover:bg-muted flex h-11 w-full items-center gap-3 rounded-lg border px-3 text-left transition-colors"
                >
                  <FolderGit2
                    size={15}
                    strokeWidth={1.7}
                    className="text-muted-foreground shrink-0"
                  />
                  <span
                    className={cn(
                      "min-w-0 flex-1 truncate text-[12px]",
                      path ? "font-mono" : "text-muted-foreground",
                    )}
                  >
                    {path || "Choose a Git repository"}
                  </span>
                  <span className="text-muted-foreground text-[11px]">
                    Browse
                  </span>
                </button>
              ) : (
                <input
                  value={path}
                  onChange={(event) => setPath(event.target.value)}
                  placeholder="/path/to/repository"
                  aria-label="Repository path"
                  className="bg-muted border-border focus:border-foreground/25 h-11 w-full rounded-lg border px-3 font-mono text-[12px] outline-none"
                />
              )
            ) : (
              <input
                id="project-remote"
                value={remoteUrl}
                onChange={(event) => setRemoteUrl(event.target.value)}
                placeholder="https://github.com/you/project.git"
                aria-label="Git URL"
                className="bg-muted border-border focus:border-foreground/25 h-11 w-full rounded-lg border px-3 font-mono text-[12px] outline-none"
              />
            )}
          </div>

          <p className="text-muted-foreground mt-3 text-[11px] leading-4">
            Private repositories use your Mac’s Git credentials. Attach an
            existing checkout, or run <code>gh auth login</code> and{" "}
            <code>gh auth setup-git</code> before adding an HTTPS URL. SSH keys
            work too. Agents get separate worktrees.
          </p>

          {projects.error ? (
            <div className="border-destructive/20 bg-destructive/[0.06] text-destructive mt-3 rounded-lg border px-3 py-2 text-[11px] leading-4">
              {projects.error}
            </div>
          ) : null}
        </div>

        <DialogFooter className="border-border/70 border-t px-5 py-4">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            loading={projects.busy}
            disabled={source === "attach" ? !path.trim() : !remoteUrl.trim()}
            onClick={() => void submit()}
          >
            Add project
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
