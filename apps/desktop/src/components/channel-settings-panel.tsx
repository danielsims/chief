import type { ReactNode } from "react";
import { Archive, Hash, Lock, Trash2 } from "lucide-react";

import type { SidebarChannel } from "./channel-browser-dialog";

/** Channel settings, laid out like Slack's: details first, then the
 * lifecycle actions that change who can see the channel or whether it
 * exists at all. */
export function ChannelSettingsPanel({
  busy,
  canManage,
  channel,
  nameField,
  onArchive,
  onDelete,
  onSetPrivate,
}: {
  busy: boolean;
  canManage: boolean;
  channel: SidebarChannel;
  nameField: ReactNode;
  onArchive: () => void;
  onDelete: () => void;
  onSetPrivate: (isPrivate: boolean) => void;
}) {
  const isPrivate = channel.visibility === "private";
  const archived = channel.lifecycle === "archived";

  return (
    <div className="space-y-4">
      <div className="border-border/70 bg-muted/25 divide-y overflow-hidden rounded-2xl border">
        {nameField}
      </div>

      {canManage ? (
        <div className="border-border/70 bg-muted/25 divide-y overflow-hidden rounded-2xl border">
          <SettingsAction
            disabled={busy || archived}
            icon={
              isPrivate ? (
                <Hash className="size-4" />
              ) : (
                <Lock className="size-4" />
              )
            }
            label={
              isPrivate
                ? "Change to a public channel"
                : "Change to a private channel"
            }
            onClick={() => onSetPrivate(!isPrivate)}
          />
          <SettingsAction
            destructive={!archived}
            disabled={busy}
            icon={<Archive className="size-4" />}
            label={
              archived ? "Restore channel" : "Archive channel for everyone"
            }
            onClick={onArchive}
          />
          {channel.id !== "general" ? (
            <SettingsAction
              destructive
              disabled={busy}
              icon={<Trash2 className="size-4" />}
              label="Delete this channel"
              onClick={onDelete}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function SettingsAction({
  destructive = false,
  disabled,
  icon,
  label,
  onClick,
}: {
  destructive?: boolean;
  disabled: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={
        destructive
          ? "text-destructive hover:bg-destructive/[0.05] flex w-full items-center gap-3 px-5 py-4 text-left text-sm font-semibold disabled:opacity-50"
          : "text-foreground hover:bg-foreground/[0.035] flex w-full items-center gap-3 px-5 py-4 text-left text-sm font-semibold disabled:opacity-50"
      }
    >
      {icon}
      {label}
    </button>
  );
}
