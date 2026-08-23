import type { useAuth } from "../lib/auth/auth-context";
import { UserAvatar } from "../components/user-avatar";

export function WorkspaceProgress({ step }: { step: number }) {
  return (
    <div
      className="fixed top-[43px] left-1/2 z-50 flex w-52 -translate-x-1/2 gap-2"
      aria-label={`Step ${step + 1} of 4`}
    >
      {[0, 1, 2, 3].map((position) => (
        <span
          key={position}
          className={`h-[3px] flex-1 rounded-full transition-colors duration-300 ${position <= step ? "bg-foreground" : "bg-muted"}`}
        />
      ))}
    </div>
  );
}

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
  onCreate,
  onJoin,
}: {
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
          Start somewhere new or join a workspace shared with you.
        </p>
      </div>

      <div className="mt-8 space-y-1">
        <WorkspaceAction
          title="Create a workspace"
          description="Start a new space for your agents and team"
          onClick={onCreate}
        />
        <WorkspaceAction
          title="Join with an invitation"
          description="Open a workspace someone shared with you"
          onClick={onJoin}
        />
      </div>
    </>
  );
}

export function WorkspaceAction({
  title,
  description,
  onClick,
  disabled = false,
}: {
  title: string;
  description: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="hover:bg-foreground/[0.035] focus-visible:bg-foreground/[0.035] flex w-full items-center rounded-xl px-4 py-4 text-left transition-colors duration-150 outline-none disabled:opacity-50"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{title}</span>
        <span className="text-muted-foreground mt-0.5 block text-xs">
          {description}
        </span>
      </span>
    </button>
  );
}
