import type { ReactNode } from "react";
import { Archive, Hash, Lock, Trash2 } from "lucide-react";

import { Button } from "@chief/ui/components/button";
import { Switch } from "@chief/ui/components/switch";

import type { SidebarChannel } from "./channel-browser-dialog";
import { useChannelLinks } from "./chat/channel-guests";

/** Channel settings, laid out like Slack's: details first, then the
 * lifecycle actions that change who can see the channel or whether it
 * exists at all. */
export function ChannelSettingsPanel({
  agentsCanManage,
  busy,
  canManage,
  channel,
  nameField,
  onArchive,
  onDelete,
  onSetAgentManagement,
  onSetPrivate,
}: {
  agentsCanManage: boolean;
  busy: boolean;
  canManage: boolean;
  channel: SidebarChannel;
  nameField: ReactNode;
  onArchive: () => void;
  onDelete: () => void;
  onSetAgentManagement: (enabled: boolean) => void;
  onSetPrivate: (isPrivate: boolean) => void;
}) {
  const isPrivate = channel.visibility === "private";
  const archived = channel.lifecycle === "archived";
  const links = useChannelLinks(channel.id);

  return (
    <div className="space-y-4">
      <div className="border-border/70 bg-muted/25 divide-y overflow-hidden rounded-2xl border">
        {nameField}
        {archived ? null : (
          <section className="flex items-center gap-4 px-5 py-4">
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-semibold">Your agent</h3>
              <p className="text-muted-foreground mt-1 text-sm leading-5">
                Invite your own agent, like Claude or Grok, to read and post
                here. It shows as working for you.
              </p>
            </div>
            <Button
              size="sm"
              title="A single-use link for your own agent. It expires in 24 hours."
              type="button"
              variant="outline"
              onClick={() => void links.copyInvite()}
            >
              {links.inviteState === "copied"
                ? "Invite copied"
                : links.inviteState === "failed"
                  ? "Couldn’t create invite"
                  : "Copy invite"}
            </Button>
          </section>
        )}
        {canManage ? (
          <section className="flex items-center gap-4 px-5 py-4">
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-semibold">
                Agent channel management
              </h3>
              <p className="text-muted-foreground mt-1 text-sm leading-5">
                Let agents update details, invite teammates, track feature work
                and archive this channel when the work is done.
              </p>
            </div>
            <Switch
              aria-label="Allow agents to manage this channel"
              checked={agentsCanManage}
              disabled={busy}
              onCheckedChange={onSetAgentManagement}
            />
          </section>
        ) : null}
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
