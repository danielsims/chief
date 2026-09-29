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
 * Connecting a repository: a short introduction the first time, then paste a
 * GitHub link. Public repositories are added straight away; a private one
 * connects GitHub first (naming the workspace's own app on a self-hosted
 * relay) and is added as soon as GitHub hands back.
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
  const [started, setStarted] = useState(false);
  const [naming, setNaming] = useState(false);
  const [checking, setChecking] = useState(false);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [appName, setAppName] = useState(defaultAppName(workspaceName));
  // A private repository waiting for GitHub to be connected before it's added.
  const pending = useRef<string | null>(null);
  const submitting = useRef(false);

  const ready = github.state.status === "ready" ? github.state : null;
  const connected = ready ? isGitHubConnected(ready.connection) : false;
  const waiting = ready?.waiting ?? false;
  const busy = adding || checking || projects.busy;
  const step = naming
    ? "name"
    : started || connected || initialRemoteUrl
      ? "repository"
      : "intro";

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
    setNaming(false);
    try {
      await action();
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
    setChecking(true);
    const publicRepository =
      connected || (await isPublic(repository).catch(() => false));
    setChecking(false);
    if (publicRepository) {
      await add(remoteUrl);
      return;
    }
    if (!ready?.connection.canManage) {
      setError("A workspace owner needs to connect GitHub first.");
      return;
    }
    pending.current = remoteUrl;
    if (ready.connection.app) await openGitHub(github.connect);
    else setNaming(true);
  };

  const shownError = error ?? projects.error;

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
            {step === "intro"
              ? "Connect Chief to GitHub"
              : step === "name"
                ? "Name your GitHub App"
                : "Add a repository"}
          </DialogTitle>
          <DialogDescription>
            {step === "intro"
              ? "Give your agents the repositories you choose."
              : step === "name"
                ? "GitHub shows this name when you share repositories."
                : "Paste a GitHub link for your agents to work in."}
          </DialogDescription>
        </DialogHeader>

        <div className="px-5 pt-5 pb-5">
          {step === "intro" ? (
            <div className="py-6">
              <GitHubConnectIllustration />
            </div>
          ) : step === "name" ? (
            <input
              autoFocus
              aria-label="GitHub App name"
              value={appName}
              maxLength={34}
              onChange={(event) => setAppName(event.target.value)}
              className="border-border/70 focus:border-foreground/25 h-10 w-full rounded-lg border bg-transparent px-3 text-sm outline-none"
            />
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
              className="border-border/70 focus:border-foreground/25 h-10 w-full rounded-lg border bg-transparent px-3 text-sm outline-none"
            />
          )}
          {shownError ? (
            <p role="alert" className="text-destructive mt-2 text-xs leading-5">
              {shownError}
            </p>
          ) : null}
        </div>

        <DialogFooter className="border-border/70 border-t px-5 py-3">
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => {
              if (step === "name") {
                setNaming(false);
                pending.current = null;
              } else {
                onOpenChange(false);
              }
            }}
          >
            {step === "name" ? "Back" : "Cancel"}
          </Button>
          {step === "intro" ? (
            <Button onClick={() => setStarted(true)}>Get started</Button>
          ) : step === "name" ? (
            <Button
              disabled={!appName.trim()}
              onClick={() =>
                void openGitHub(() => github.setUp(appName.trim()))
              }
            >
              Continue to GitHub
            </Button>
          ) : (
            <Button
              disabled={!url.trim() || busy || waiting}
              onClick={() => void connectRepository()}
            >
              {waiting
                ? "Opening GitHub…"
                : adding
                  ? "Connecting…"
                  : checking
                    ? "Checking…"
                    : "Connect repository"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * GitHub App names are unique across GitHub, so the workspace's name makes
 * this one its own while still reading as Chief.
 */
function defaultAppName(workspaceName: string | undefined) {
  const name = workspaceName?.trim();
  return (name ? `Chief for ${name}` : "Chief").slice(0, 34);
}
