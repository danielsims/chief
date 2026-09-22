import { useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { FolderGit2, LoaderCircle } from "lucide-react";
import { toast } from "sonner";

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

import { prepareDesktopPluginHost } from "../../lib/desktop-plugin-host";
import { useProjects } from "../../lib/runtime-projects";

type ProjectSource = "attach" | "clone";

interface AddProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialRemoteUrl?: string;
}

export function AddProjectDialog(props: AddProjectDialogProps) {
  return props.open ? <AddProjectDialogForm {...props} /> : null;
}

function AddProjectDialogForm({
  open: visible,
  onOpenChange,
  initialRemoteUrl,
}: AddProjectDialogProps) {
  const projects = useProjects();
  const submitting = useRef(false);
  const [preparing, setPreparing] = useState(false);
  const [setupStatus, setSetupStatus] = useState<string | null>(null);
  const [setupError, setSetupError] = useState<string | null>(null);
  const busy = preparing || projects.busy;
  const [source, setSource] = useState<ProjectSource>(
    initialRemoteUrl ? "clone" : "attach",
  );
  const [path, setPath] = useState("");
  const [remoteUrl, setRemoteUrl] = useState(initialRemoteUrl ?? "");

  const chooseFolder = async () => {
    if (!isTauri()) return;
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Choose a repository folder",
    });
    if (isJsonString(selected)) setPath(selected);
  };

  const submit = async () => {
    if (submitting.current) return;
    submitting.current = true;
    setPreparing(true);
    setSetupError(null);
    projects.clearError();
    setSetupStatus("Preparing local tools…");
    let unlisten: (() => void) | undefined;
    let toastId: string | number | undefined;
    try {
      if (isTauri()) {
        unlisten = await listen<string>(
          "chief://plugin-runtime-progress",
          ({ payload }) => {
            const message = {
              downloading: "Downloading Chief plugin runtime…",
              verifying: "Verifying Chief plugin runtime…",
              installing: "Installing Chief plugin runtime…",
              starting: "Starting local tools…",
            }[payload];
            if (!message) return;
            setSetupStatus(message);
            if (payload === "downloading" || toastId !== undefined) {
              toastId = toast.loading(message, { id: toastId });
            }
          },
        );
        await prepareDesktopPluginHost();
      }
      unlisten?.();
      unlisten = undefined;
      if (toastId !== undefined) {
        toast.success("Chief plugin runtime is ready", { id: toastId });
        toastId = undefined;
      }
      setSetupStatus(
        source === "clone"
          ? "Cloning and connecting…"
          : "Connecting repository…",
      );
      if (source === "attach") await projects.attach(path);
      else await projects.clone(remoteUrl);
      setPath("");
      setRemoteUrl("");
      onOpenChange(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setSetupError(message);
      if (toastId !== undefined) toast.error(message, { id: toastId });
    } finally {
      unlisten?.();
      submitting.current = false;
      setPreparing(false);
      setSetupStatus(null);
    }
  };

  return (
    <Dialog
      open={visible}
      onOpenChange={(next) => {
        if (!busy) onOpenChange(next);
      }}
    >
      <DialogContent className="border-border/70 max-w-[460px] gap-0 overflow-hidden rounded-xl p-0">
        <DialogHeader className="px-5 pt-5 pb-4">
          <DialogTitle className="text-[17px] font-medium tracking-tight">
            Connect a repository
          </DialogTitle>
          <DialogDescription>
            Choose a local checkout or clone a repository to this Mac.
          </DialogDescription>
        </DialogHeader>

        <div className="px-5 pb-5">
          <div className="border-border/60 flex gap-5 border-b">
            {(
              [
                ["attach", "Local folder"],
                ["clone", "Repository URL"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                disabled={busy}
                onClick={() => {
                  setSetupError(null);
                  setSource(value);
                  projects.clearError();
                }}
                className={cn(
                  "text-muted-foreground -mb-px flex h-9 items-center border-b-2 border-transparent text-sm transition-colors",
                  source === value && "border-foreground text-foreground",
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
                  disabled={busy}
                  onClick={() => void chooseFolder()}
                  className="border-border/70 hover:bg-muted/40 flex h-11 w-full items-center gap-3 rounded-md border bg-transparent px-3 text-left transition-colors"
                >
                  <FolderGit2
                    size={15}
                    strokeWidth={1.7}
                    className="text-muted-foreground shrink-0"
                  />
                  <span
                    className={cn(
                      "min-w-0 flex-1 truncate text-sm",
                      path ? "font-mono" : "text-muted-foreground",
                    )}
                  >
                    {path || "Choose a repository folder"}
                  </span>
                  <span className="text-muted-foreground text-sm">Browse</span>
                </button>
              ) : (
                <input
                  disabled={busy}
                  value={path}
                  onChange={(event) => setPath(event.target.value)}
                  placeholder="/path/to/repository"
                  aria-label="Repository path"
                  className="border-border/70 focus:border-foreground/25 h-10 w-full rounded-md border bg-transparent px-3 text-sm outline-none"
                />
              )
            ) : (
              <input
                disabled={busy}
                id="project-remote"
                value={remoteUrl}
                onChange={(event) => setRemoteUrl(event.target.value)}
                placeholder="https://github.com/you/project.git"
                aria-label="Git URL"
                className="border-border/70 focus:border-foreground/25 h-10 w-full rounded-md border bg-transparent px-3 text-sm outline-none"
              />
            )}
          </div>

          <p className="text-muted-foreground mt-3 text-sm leading-5">
            Agents work in their own checkout, keeping your working copy
            separate.
          </p>
          {source === "clone" ? (
            <details className="text-muted-foreground mt-3 text-sm leading-5">
              <summary className="cursor-pointer">
                Private repository access
              </summary>
              <p className="mt-2">
                Chief uses your Mac’s existing Git credentials. HTTPS and SSH
                URLs both work. For GitHub, sign in with{" "}
                <code>gh auth login</code>, then run{" "}
                <code>gh auth setup-git</code>.
              </p>
            </details>
          ) : null}

          {setupStatus ? (
            <div
              role="status"
              className="text-muted-foreground mt-3 flex items-center gap-2 text-sm"
            >
              <LoaderCircle
                aria-hidden="true"
                className="size-4 animate-spin"
              />
              {setupStatus}
            </div>
          ) : null}
          {setupError || projects.error ? (
            <div className="border-destructive/20 bg-destructive/[0.06] text-destructive mt-3 rounded-lg border px-3 py-2 text-sm leading-5">
              {setupError ?? projects.error}
            </div>
          ) : null}
        </div>

        <DialogFooter className="border-border/70 border-t px-5 py-3">
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            loading={busy}
            disabled={source === "attach" ? !path.trim() : !remoteUrl.trim()}
            onClick={() => void submit()}
          >
            {source === "attach" ? "Connect folder" : "Clone and connect"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
