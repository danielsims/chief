import { useEffect, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { ChevronRight } from "lucide-react";

import { Button } from "@chief/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@chief/ui/components/dialog";

import { createChiefGitRepository } from "../../lib/chief-git";
import { prepareDesktopPluginHost } from "../../lib/desktop-plugin-host";
import {
  isGitHubConnected,
  isPublicGitHubRepository,
  useGitHubConnection,
} from "../../lib/github-connection";
import { githubRepositoryName } from "../../lib/relay-runtime-project-connect";
import { useRelaySession } from "../../lib/relay-session-context";
import { useProjects } from "../../lib/runtime-projects";
import { ChiefMark } from "../chief-mark";
import { GitHubMark } from "./github-mark";

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
  const { client, snapshot } = useRelaySession();
  const github = useGitHubConnection();
  return (
    <AddProjectDialogForm
      {...props}
      projects={projects}
      github={github}
      workspaceName={snapshot?.name}
      createRepository={async (name) => {
        if (!client || !snapshot) throw new Error("Chief isn't connected yet.");
        await createChiefGitRepository(client, snapshot.id, name);
        projects.refresh();
      }}
    />
  );
}

interface AddProjectDialogFormProps extends AddProjectDialogProps {
  projects: Pick<
    ReturnType<typeof useProjects>,
    "busy" | "error" | "clearError" | "clone"
  >;
  github: Pick<
    ReturnType<typeof useGitHubConnection>,
    "state" | "connect" | "setUp"
  >;
  workspaceName?: string;
  /** Creates a repository hosted by the workspace's relay. */
  createRepository: (name: string) => Promise<void>;
}

type Step = "source" | "chief-git" | "github" | "name";

/**
 * Connecting source control: choose where the repository lives. Chief Git
 * creates one on the workspace's relay. GitHub takes a link: public
 * repositories are added straight away; a private one connects GitHub first
 * (naming the workspace's own app on a self-hosted relay) and is added as
 * soon as GitHub hands back.
 */
function AddProjectDialogForm({
  open: visible,
  onOpenChange,
  initialRemoteUrl,
  projects,
  github,
  workspaceName,
  createRepository,
}: AddProjectDialogFormProps) {
  const [url, setUrl] = useState(initialRemoteUrl ?? "");
  const [step, setStep] = useState<Step>(
    initialRemoteUrl ? "github" : "source",
  );
  const [repositoryName, setRepositoryName] = useState("");
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
    setStep("github");
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
      connected ||
      (await isPublicGitHubRepository(repository).catch(() => false));
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
    else setStep("name");
  };

  const createChiefGit = async () => {
    if (submitting.current) return;
    submitting.current = true;
    setAdding(true);
    setError(null);
    try {
      await createRepository(repositoryName);
      onOpenChange(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      submitting.current = false;
      setAdding(false);
    }
  };

  const goTo = (next: Step) => {
    setError(null);
    setStep(next);
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
            {TITLES[step]}
          </DialogTitle>
          <DialogDescription>{DESCRIPTIONS[step]}</DialogDescription>
        </DialogHeader>

        <div className="px-5 pt-5 pb-5">
          {step === "source" ? (
            <div className="space-y-2">
              <SourceOption
                icon={<ChiefMark className="size-4" />}
                label="Continue with Chief Git Relay"
                onSelect={() => goTo("chief-git")}
              />
              <SourceOption
                icon={<GitHubMark className="size-4" />}
                label="Continue with GitHub"
                onSelect={() => goTo("github")}
              />
            </div>
          ) : step === "chief-git" ? (
            <input
              autoFocus
              disabled={busy}
              value={repositoryName}
              maxLength={120}
              onChange={(event) => {
                setRepositoryName(event.target.value);
                setError(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && repositoryName.trim())
                  void createChiefGit();
              }}
              placeholder="Repository name"
              aria-label="Repository name"
              className="border-border/70 focus:border-foreground/25 h-10 w-full rounded-lg border bg-transparent px-3 text-sm outline-none"
            />
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

        {step === "source" ? null : (
          <DialogFooter className="border-border/70 border-t px-5 py-3">
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => {
                pending.current = null;
                goTo(step === "name" ? "github" : "source");
              }}
            >
              Back
            </Button>
            {step === "chief-git" ? (
              <Button
                disabled={!repositoryName.trim() || busy}
                onClick={() => void createChiefGit()}
              >
                {adding ? "Creating…" : "Create repository"}
              </Button>
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
        )}
      </DialogContent>
    </Dialog>
  );
}

const TITLES: Record<Step, string> = {
  source: "Connect Chief to source control",
  "chief-git": "Create a repository",
  github: "Add a GitHub repository",
  name: "Name your GitHub App",
};

const DESCRIPTIONS: Record<Step, string> = {
  source: "Choose where your agents' repositories live.",
  "chief-git": "Chief hosts it on your relay.",
  github: "Paste a GitHub link for your agents to work in.",
  name: "GitHub shows this name when you share repositories.",
};

function SourceOption({
  icon,
  label,
  onSelect,
}: {
  icon: React.ReactNode;
  label: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="border-border/70 hover:bg-accent focus-visible:ring-ring/30 flex h-12 w-full items-center gap-3 rounded-lg border px-4 text-left text-sm font-medium transition-colors outline-none focus-visible:ring-2"
    >
      {icon}
      <span className="flex-1">{label}</span>
      <ChevronRight
        aria-hidden="true"
        className="text-muted-foreground size-4"
      />
    </button>
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
