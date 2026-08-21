import type { ReactNode } from "react";
import { ChevronRight, Link2, Plus } from "lucide-react";

import { Button } from "@chief/ui/components/button";
import { Input } from "@chief/ui/components/input";

import type { useAuth } from "../lib/auth/auth-context";
import type { useRelaySession } from "../lib/relay-session";
import { OrgLogo } from "../components/org-logo";
import { UserAvatar } from "../components/user-avatar";

export function AccountIndicator({
  user,
  onSignOut,
  disabled,
}: {
  user: ReturnType<typeof useAuth>["user"];
  onSignOut: () => void;
  disabled: boolean;
}) {
  if (!user) return null;
  return (
    <div className="fixed top-10 left-4 z-50 flex items-center gap-2">
      <UserAvatar image={user.image} name={user.name} className="size-7" />
      <span className="text-muted-foreground max-w-44 truncate text-[13px]">
        {user.name}
      </span>
      <span className="text-muted-foreground/40 text-[13px]">·</span>
      <button
        type="button"
        onClick={onSignOut}
        disabled={disabled}
        className="text-muted-foreground hover:text-foreground text-[13px] transition-colors disabled:opacity-50"
      >
        Sign out
      </button>
    </div>
  );
}

export function WorkspaceHome({
  hasWorkspaces,
  onExisting,
  onCreate,
  onJoin,
}: {
  hasWorkspaces: boolean;
  onExisting: () => void;
  onCreate: () => void;
  onJoin: () => void;
}) {
  return (
    <>
      <div>
        <h1 className="text-[32px] leading-tight font-normal tracking-[-0.04em]">
          Set up your workspace
        </h1>
        <p className="text-muted-foreground mt-2 max-w-lg text-sm leading-6">
          Open a workspace, start somewhere new, or join one shared with you.
        </p>
      </div>

      <div className="mt-8 border-y">
        {hasWorkspaces ? (
          <WorkspaceAction
            icon={<ChevronRight size={16} />}
            title="Open a workspace"
            description="Continue in a workspace on your account"
            onClick={onExisting}
          />
        ) : null}
        <WorkspaceAction
          icon={<Plus size={16} />}
          title="Create a workspace"
          description="Start a new space for your agents and team"
          onClick={onCreate}
          bordered={hasWorkspaces}
        />
        <WorkspaceAction
          icon={<Link2 size={15} />}
          title="Join with an invitation"
          description="Open a workspace someone shared with you"
          onClick={onJoin}
          bordered
        />
      </div>
    </>
  );
}

export function ExistingWorkspaces({
  workspaces,
  switchingTo,
  onSelect,
}: {
  workspaces: ReturnType<typeof useRelaySession>["workspaces"];
  switchingTo: string | null;
  onSelect: (workspaceId: string) => void;
}) {
  return (
    <div>
      <h1 className="text-[32px] leading-tight font-normal tracking-[-0.04em]">
        Open a workspace
      </h1>
      <p className="text-muted-foreground mt-2 text-sm leading-6">
        Choose where you’d like to continue.
      </p>
      <div className="mt-7 max-h-80 overflow-y-auto border-y">
        {workspaces.map((workspace, index) => (
          <button
            key={workspace.id}
            type="button"
            disabled={switchingTo !== null}
            onClick={() => onSelect(workspace.id)}
            className={`hover:bg-accent/40 focus-visible:bg-accent/40 flex w-full items-center gap-3 px-1 py-3.5 text-left transition-colors outline-none disabled:opacity-50 ${
              index > 0 ? "border-t" : ""
            }`}
          >
            <OrgLogo
              name={workspace.name}
              logo={workspace.imageURL}
              website={workspace.website}
              className="size-9 shrink-0 rounded-[11px] text-sm"
              imgClassName="object-contain"
              transparentWhenLoaded
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">
                {workspace.name}
              </span>
              {workspace.website ? (
                <span className="text-muted-foreground mt-0.5 block truncate text-xs">
                  {workspace.website}
                </span>
              ) : null}
            </span>
            <span className="text-muted-foreground pr-1 text-xs">
              {switchingTo === workspace.id ? (
                "Opening…"
              ) : (
                <ChevronRight size={15} />
              )}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function WorkspaceAction({
  icon,
  title,
  description,
  onClick,
  bordered = false,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  onClick: () => void;
  bordered?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`hover:bg-accent/40 focus-visible:bg-accent/40 flex w-full items-center gap-3 px-1 py-3.5 text-left transition-colors outline-none ${bordered ? "border-t" : ""}`}
    >
      <span className="bg-muted text-muted-foreground flex size-8 items-center justify-center rounded-lg">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{title}</span>
        <span className="text-muted-foreground mt-0.5 block text-xs">
          {description}
        </span>
      </span>
      <ChevronRight className="text-muted-foreground mr-1" size={15} />
    </button>
  );
}

export function ConnectionNotice({
  message,
  retrying,
  onRetry,
}: {
  message: string;
  retrying: boolean;
  onRetry: () => void;
}) {
  return (
    <div className="text-muted-foreground fixed top-9 right-4 z-50 flex max-w-[min(460px,46vw)] items-center gap-2 text-xs leading-5">
      <span className="bg-destructive size-1.5 shrink-0 rounded-full" />
      <span className="min-w-0 flex-1">
        <span className="text-foreground">Couldn’t connect.</span> {message}
      </span>
      <button
        type="button"
        onClick={onRetry}
        disabled={retrying}
        className="text-foreground shrink-0 font-medium hover:underline disabled:opacity-50"
      >
        {retrying ? "Connecting…" : "Try again"}
      </button>
    </div>
  );
}

export function CreateForm({
  name,
  website,
  working,
  connected,
  onNameChange,
  onWebsiteChange,
  onSubmit,
}: {
  name: string;
  website: string;
  working: boolean;
  connected: boolean;
  onNameChange: (value: string) => void;
  onWebsiteChange: (value: string) => void;
  onSubmit: (event: React.FormEvent) => void;
}) {
  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <div>
        <h1 className="text-[32px] leading-tight font-normal tracking-[-0.04em]">
          Create a workspace
        </h1>
        <p className="text-muted-foreground mt-2 text-sm leading-6">
          Tell Chief where your agents will be working.
        </p>
      </div>
      <div className="space-y-4">
        <Field label="Company name" htmlFor="new-workspace-name">
          <Input
            id="new-workspace-name"
            autoFocus
            value={name}
            onChange={(event) => onNameChange(event.target.value)}
            placeholder="Acme Inc"
            disabled={working}
          />
        </Field>
        <Field label="Company website" htmlFor="new-workspace-website">
          <Input
            id="new-workspace-website"
            value={website}
            onChange={(event) => onWebsiteChange(event.target.value)}
            placeholder="acme.com"
            disabled={working}
          />
        </Field>
      </div>
      <div className="flex justify-end border-t pt-4">
        <Button
          type="submit"
          disabled={!name.trim() || working || !connected}
          loading={working}
        >
          Continue
        </Button>
      </div>
    </form>
  );
}

export function JoinForm({
  invite,
  preview,
  working,
  connected,
  onInviteChange,
  onPrepare,
  onJoin,
}: {
  invite: string;
  preview: {
    workspaceName: string;
    conversationName: string | null;
  } | null;
  working: boolean;
  connected: boolean;
  onInviteChange: (value: string) => void;
  onPrepare: () => void;
  onJoin: () => void;
}) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[32px] leading-tight font-normal tracking-[-0.04em]">
          Join a workspace
        </h1>
        <p className="text-muted-foreground mt-2 text-sm leading-6">
          Paste the invitation link you received.
        </p>
      </div>
      {preview ? (
        <div className="border-y py-4">
          <p className="text-sm font-medium">{preview.workspaceName}</p>
          <p className="text-muted-foreground mt-1 text-xs">
            {preview.conversationName
              ? `You’ll join #${preview.conversationName}.`
              : "You’ll join this workspace."}
          </p>
        </div>
      ) : (
        <Field label="Invitation link" htmlFor="workspace-invite">
          <Input
            id="workspace-invite"
            autoFocus
            value={invite}
            onChange={(event) => onInviteChange(event.target.value)}
            placeholder="https://…/invite/…"
            disabled={working}
          />
        </Field>
      )}
      <div className="flex justify-end border-t pt-4">
        <Button
          disabled={!invite.trim() || working || !connected}
          loading={working}
          onClick={preview ? onJoin : onPrepare}
        >
          {preview ? "Join workspace" : "Continue"}
        </Button>
      </div>
    </div>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <label className="text-[13px] font-medium" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
    </div>
  );
}
