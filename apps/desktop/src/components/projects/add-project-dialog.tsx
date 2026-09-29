import { useEffect, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";

import { Button } from "@chief/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@chief/ui/components/dialog";

import { prepareDesktopPluginHost } from "../../lib/desktop-plugin-host";
import {
  isGitHubConnected,
  isPublicGitHubRepository,
  useGitHubConnection,
} from "../../lib/github-connection";
import { githubRepositoryName } from "../../lib/relay-runtime-project-connect";
import { useRelaySession } from "../../lib/relay-session-context";
import { useProjects } from "../../lib/runtime-projects";
import { GitHubConnectIllustration } from "./github-connect-illustration";

interface AddProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialRemoteUrl?: string;
}

export function AddProjectDialog(props: AddProjectDialogProps) {
  return props.open ? <ConnectedAddProjectDialog {...props} /> : null;
}

function ConnectedAddProjectDialog(props: AddProjectDialogProps) {
  const projects = useProjects();
  const { snapshot } = useRelaySession();
  const github = useGitHubConnection();
  return (
    <AddProjectDialogForm
      {...props}
      projects={projects}
      github={github}
      workspaceName={snapshot?.name}
    />
  );
}

export interface AddProjectDialogFormProps extends AddProjectDialogProps {
  projects: Pick<
    ReturnType<typeof useProjects>,
    "busy" | "error" | "clearError" | "clone"
  >;
  github: Pick<
    ReturnType<typeof useGitHubConnection>,
    "state" | "connect" | "setUp"
  >;
  workspaceName?: string;
  /** Whether GitHub serves the repository to anyone; injectable for previews. */
  isPublic?: (repository: string) => Promise<boolean>;
}

/**
 * Paste a GitHub link and connect it. Public repositories are added straight
 * away; a private one first connects GitHub, then is added when that finishes.
 */
export function AddProjectDialogForm({
  open: visible,
  onOpenChange,
  initialRemoteUrl,
  projects,
  github,
  workspaceName,
  isPublic = isPublicGitHubRepository,
}: AddProjectDialogFormProps) {
  const [url, setUrl] = useState(initialRemoteUrl ?? "");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settingUp, setSettingUp] = useState(false);
  const [appName, setAppName] = useState(
    defaultAppName(workspaceName).slice(0, 34),
  );
  // A private repository waiting for GitHub to be connected before it's added.
  const pending = useRef<string | null>(null);
  const submitting = useRef(false);

  const ready = github.state.status === "ready" ? github.state : null;
  const connected = ready ? isGitHubConnected(ready.connection) : false;
  const waiting = ready?.waiting ?? false;
  const busy = adding || projects.busy;

  const add = async (remoteUrl: string) => {
    if (submitting.current) return;
    submitting.current = true;
    setAdding(true);
    setError(null);
    projects.clearError();
    try {
      // Local tools may still be installing in the background; wait quietly.
      if (isTauri()) await prepareDesktopPluginHost();
      await projects.clone(remoteUrl);
      onOpenChange(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      submitting.current = false;
      setAdding(false);
    }
  };

  // Once GitHub is connected, finish adding the private repository.
  useEffect(() => {
    const remoteUrl = pending.current;
    if (remoteUrl && connected && !waiting) {
      pending.current = null;
      void add(remoteUrl);
    }
  });

  const openGitHub = async (action: () => Promise<void>) => {
    try {
      await action();
      setSettingUp(false);
    } catch (cause) {
      pending.current = null;
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const connectRepository = async () => {
    const remoteUrl = url.trim();
    const repository = githubRepositoryName(remoteUrl);
    if (!repository) {
      setError("Paste a GitHub repository link.");
      return;
    }
    setError(null);
    if (connected || (await isPublic(repository).catch(() => false))) {
      await add(remoteUrl);
      return;
    }
    if (!ready?.connection.canManage) {
      setError("A workspace owner needs to connect GitHub first.");
      return;
    }
    pending.current = remoteUrl;
    if (ready.connection.app) await openGitHub(github.connect);
    else setSettingUp(true);
  };

  const status = error ?? projects.error;

  return (
    <Dialog
      open={visible}
      onOpenChange={(next) => {
        if (!busy) onOpenChange(next);
      }}
    >
      <DialogContent className="border-border/70 max-w-[440px] gap-0 overflow-hidden rounded-xl p-0">
        <DialogHeader className="px-5 pt-5">
          <DialogTitle className="text-[17px] font-medium tracking-tight">
            {settingUp ? "Connect GitHub" : "Add a repository"}
          </DialogTitle>
          <DialogDescription>
            {settingUp
              ? "Chief creates a private GitHub App for this workspace."
              : "Paste a GitHub link for your agents to work in."}
          </DialogDescription>
        </DialogHeader>

        <div className="px-5 pt-7 pb-5">
          <GitHubConnectIllustration waiting={waiting} />
          {settingUp ? (
            <>
              <label
                htmlFor="github-app-name"
                className="mt-7 block text-sm font-medium"
              >
                App name
              </label>
              <input
                id="github-app-name"
                value={appName}
                maxLength={34}
                onChange={(event) => setAppName(event.target.value)}
                className="border-border/70 focus:border-foreground/25 mt-2 h-10 w-full rounded-lg border bg-transparent px-3 text-sm outline-none"
              />
            </>
          ) : (
            <input
              autoFocus
              disabled={busy || waiting}
              value={url}
              onChange={(event) => {
                setUrl(event.target.value);
                setError(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") void connectRepository();
              }}
              placeholder="https://github.com/owner/repository"
              aria-label="GitHub repository link"
              className="border-border/70 focus:border-foreground/25 mt-7 h-10 w-full rounded-lg border bg-transparent px-3 text-sm outline-none"
            />
          )}
          <p
            role="status"
            className={
              status
                ? "text-destructive mt-2 min-h-5 text-xs leading-5"
                : "text-muted-foreground mt-2 min-h-5 text-xs leading-5"
            }
          >
            {status ??
              (waiting ? "Finish connecting GitHub in your browser." : null)}
          </p>
        </div>

        <DialogFooter className="border-border/70 border-t px-5 py-3">
          {settingUp ? (
            <>
              <Button
                variant="ghost"
                onClick={() => {
                  setSettingUp(false);
                  pending.current = null;
                }}
              >
                Back
              </Button>
              <Button
                disabled={!appName.trim()}
                onClick={() =>
                  void openGitHub(() => github.setUp(appName.trim()))
                }
              >
                Continue to GitHub
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button
                loading={busy || waiting}
                disabled={!url.trim()}
                onClick={() => void connectRepository()}
              >
                Connect repository
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Names the workspace's GitHub App after what it is: this team's agents. */
function defaultAppName(workspaceName: string | undefined) {
  const name = workspaceName?.trim();
  return `${name === undefined || name === "" ? "Chief" : name} Agents`;
}
