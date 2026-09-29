import { useMemo, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { Check, ExternalLink, Lock, Search } from "lucide-react";

import type { GitHubRepository } from "@chief/relay-contracts";
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
import {
  isGitHubConnected,
  useGitHubConnection,
} from "../../lib/github-connection";
import { githubRepositoryName } from "../../lib/relay-runtime-project-connect";
import { useRelaySession } from "../../lib/relay-session-context";
import { useProjects } from "../../lib/runtime-projects";
import { GitHubConnectIllustration } from "./github-connect-illustration";
import { formatProjectTime } from "./project-format";

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
}

/** The dialog itself, fed its data so it renders the same anywhere. */
export function AddProjectDialogForm({
  open: visible,
  onOpenChange,
  initialRemoteUrl,
  projects,
  github,
  workspaceName,
}: AddProjectDialogFormProps) {
  const submitting = useRef(false);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState(initialRemoteUrl ?? "");
  const [selected, setSelected] = useState<string | null>(null);
  const [settingUp, setSettingUp] = useState(false);
  const [appName, setAppName] = useState(
    defaultAppName(workspaceName).slice(0, 34),
  );
  const busy = adding || projects.busy;

  const ready = github.state.status === "ready" ? github.state : null;
  const connected = ready ? isGitHubConnected(ready.connection) : false;
  const pastedUrl = remoteUrlFrom(query);
  const repositories = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const all = ready?.repositories ?? [];
    if (pastedUrl) {
      const name = githubRepositoryName(pastedUrl)?.toLowerCase();
      return all.filter(
        (repository) => repository.fullName.toLowerCase() === name,
      );
    }
    if (!needle) return all;
    return all.filter((repository) =>
      repository.fullName.toLowerCase().includes(needle),
    );
  }, [pastedUrl, query, ready?.repositories]);
  const pastedRepository = pastedUrl
    ? ready?.repositories.find(
        (repository) =>
          repository.fullName.toLowerCase() ===
          githubRepositoryName(pastedUrl)?.toLowerCase(),
      )
    : undefined;
  const selection = pastedUrl
    ? (pastedRepository?.cloneUrl ?? pastedUrl)
    : ready?.repositories.find(({ fullName }) => fullName === selected)
        ?.cloneUrl;

  const add = async () => {
    if (!selection || submitting.current) return;
    submitting.current = true;
    setAdding(true);
    setError(null);
    projects.clearError();
    try {
      // Local tools may still be installing in the background; wait quietly.
      if (isTauri()) await prepareDesktopPluginHost();
      await projects.clone(selection);
      onOpenChange(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      submitting.current = false;
      setAdding(false);
    }
  };

  const openGitHub = async (action: () => Promise<void>) => {
    setError(null);
    try {
      await action();
      setSettingUp(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const shownError = error ?? projects.error;
  const connectGitHub = () =>
    ready?.connection.app
      ? void openGitHub(github.connect)
      : setSettingUp(true);
  // One primary action: connect GitHub until there is something to add.
  const offersConnect =
    !selection &&
    !!ready &&
    !ready.waiting &&
    !connected &&
    ready.connection.canManage;

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
            {settingUp ? "Connect GitHub" : "Add a repository"}
          </DialogTitle>
          <DialogDescription>
            {settingUp
              ? "Chief creates a private GitHub App for this workspace."
              : "Choose a repository for your agents to work in."}
          </DialogDescription>
        </DialogHeader>

        {settingUp ? (
          <div className="px-5 pb-5">
            <div className="py-5">
              <GitHubConnectIllustration />
            </div>
            <label
              htmlFor="github-app-name"
              className="mt-2 block text-sm font-medium"
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
          </div>
        ) : (
          <div className="px-5 pb-5">
            <div className="relative">
              <Search
                aria-hidden="true"
                className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
              />
              <input
                autoFocus
                disabled={busy}
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setError(null);
                }}
                placeholder={
                  connected ? "Search or paste a URL" : "Paste a repository URL"
                }
                aria-label="Search repositories or paste a URL"
                className="border-border/70 focus:border-foreground/25 h-10 w-full rounded-lg border bg-transparent pr-3 pl-9 text-sm outline-none"
              />
            </div>

            {/* A pasted URL with nothing to list needs no list at all. */}
            {pastedUrl && repositories.length === 0 ? null : (
              <div className="mt-3 h-64 overflow-y-auto">
                {github.state.status === "loading" ? (
                  <RowSkeletons />
                ) : !ready ? (
                  <Centered>
                    <p className="text-muted-foreground text-sm">
                      {github.state.status === "unavailable"
                        ? github.state.message
                        : null}
                    </p>
                  </Centered>
                ) : ready.waiting ? (
                  <Centered>
                    <GitHubConnectIllustration waiting />
                    <p className="text-muted-foreground text-sm">
                      Finish connecting in your browser.
                    </p>
                  </Centered>
                ) : !connected && pastedUrl ? null : !connected ? (
                  <Centered>
                    <GitHubConnectIllustration />
                    <p className="text-muted-foreground max-w-xs text-sm leading-5">
                      {ready.connection.canManage
                        ? "Connect GitHub to add private repositories."
                        : "A workspace owner can connect GitHub for private repositories."}
                    </p>
                  </Centered>
                ) : repositories.length === 0 &&
                  pastedUrl ? null : repositories.length === 0 ? (
                  <Centered>
                    <p className="text-muted-foreground text-sm">
                      {query.trim()
                        ? "No matching repositories."
                        : "No repositories are shared with Chief yet."}
                    </p>
                  </Centered>
                ) : (
                  <div className="space-y-0.5">
                    {repositories.map((repository) => (
                      <GitHubRepositoryRow
                        key={repository.id}
                        repository={repository}
                        selected={
                          pastedUrl
                            ? repository.fullName === pastedRepository?.fullName
                            : selected === repository.fullName
                        }
                        onSelect={() => {
                          setQuery("");
                          setSelected(repository.fullName);
                        }}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}

            {shownError ? (
              <p className="text-destructive mt-3 text-xs leading-5">
                {shownError}
              </p>
            ) : null}
          </div>
        )}

        <DialogFooter className="border-border/70 border-t px-5 py-3">
          {settingUp ? (
            <>
              <Button variant="ghost" onClick={() => setSettingUp(false)}>
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
              {connected && ready?.connection.canManage ? (
                <Button
                  variant="ghost"
                  className="text-muted-foreground mr-auto"
                  disabled={busy}
                  onClick={() => void openGitHub(github.connect)}
                >
                  Manage access
                  <ExternalLink aria-hidden="true" className="size-3.5" />
                </Button>
              ) : null}
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              {offersConnect ? (
                <Button onClick={connectGitHub}>Connect GitHub</Button>
              ) : (
                <Button
                  loading={busy}
                  disabled={!selection}
                  onClick={() => void add()}
                >
                  Add repository
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function GitHubRepositoryRow({
  repository,
  selected,
  onSelect,
}: {
  repository: GitHubRepository;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <RepositoryRow
      title={
        <>
          <span className="text-muted-foreground">{repository.owner}/</span>
          {repository.name}
          {repository.private ? (
            <Lock
              aria-label="Private"
              className="text-muted-foreground ml-1.5 inline size-3 -translate-y-px"
              strokeWidth={2}
            />
          ) : null}
        </>
      }
      meta={
        repository.updatedAt
          ? formatProjectTime(Date.parse(repository.updatedAt))
          : null
      }
      selected={selected}
      onSelect={onSelect}
    />
  );
}

function RepositoryRow({
  icon,
  title,
  meta,
  selected,
  onSelect,
}: {
  icon?: React.ReactNode;
  title: React.ReactNode;
  meta?: string | null;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        "hover:bg-accent flex h-10 w-full items-center gap-3 rounded-lg px-3 text-left transition-colors",
        selected && "bg-accent",
      )}
    >
      {icon ? (
        <span className="text-muted-foreground shrink-0">{icon}</span>
      ) : null}
      <span className="min-w-0 flex-1 truncate text-sm">{title}</span>
      {selected ? (
        <Check aria-hidden="true" className="size-4 shrink-0" />
      ) : meta ? (
        <span className="text-muted-foreground shrink-0 text-xs">{meta}</span>
      ) : null}
    </button>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
      {children}
    </div>
  );
}

function RowSkeletons() {
  return (
    <div className="space-y-0.5" aria-hidden="true">
      {[0, 1, 2, 3, 4].map((row) => (
        <div key={row} className="flex h-10 items-center gap-3 px-3">
          <span className="bg-accent size-4 rounded" />
          <span
            className="bg-accent h-3 rounded"
            style={{ width: `${40 + ((row * 17) % 35)}%` }}
          />
        </div>
      ))}
    </div>
  );
}

/** A cloneable URL typed or pasted into the search box, if that's what it is. */
function remoteUrlFrom(value: string) {
  const trimmed = value.trim();
  if (/^git@[\w.-]+:[\w./-]+$/u.test(trimmed)) return trimmed;
  try {
    const url = new URL(trimmed);
    return url.protocol === "https:" && url.pathname.split("/").length >= 3
      ? trimmed
      : null;
  } catch {
    return null;
  }
}

/** Names the workspace's GitHub App after what it is: this team's agents. */
function defaultAppName(workspaceName: string | undefined) {
  const name = workspaceName?.trim();
  return `${name === undefined || name === "" ? "Chief" : name} Agents`;
}
