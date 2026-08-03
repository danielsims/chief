import { useState } from "react";
import { Check, Copy, Hash, MoreHorizontal, UserRound } from "lucide-react";

import { Button } from "@chief/ui/components/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@chief/ui/components/popover";
import { cn } from "@chief/ui/lib/utils";

import type { WorkspaceAgentId } from "../../lib/workspace-channels";
import type { AgentPresence } from "./agent-profile-panel";
import type { ConversationProfileSelection } from "./conversation-profile";
import { WORKSPACE_AGENT_IDENTITIES } from "../../lib/workspace-channels";
import { AgentAvatar } from "../agent-avatar";
import { ChannelArtifactsMenu } from "../channel-artifacts-menu";
import { AgentPresenceAvatar } from "./agent-profile-panel";

interface ConversationHeaderChannel {
  id: string;
  label: string;
  description: string;
  agentIds: readonly string[];
}

interface ConversationHeaderProps {
  channel: ConversationHeaderChannel;
  directAgentId: WorkspaceAgentId | null;
  directIdentity: { name: string } | null;
  directPresence: AgentPresence;
  onContinueArtifact: (artifact: { id: string; title: string }) => void;
  onOpenProfile: (selection: ConversationProfileSelection) => void;
  activeView: "messages" | "canvas";
  onViewChange: (view: "messages" | "canvas") => void;
  user: { image?: string | null; name: string } | null;
}

export function ConversationHeader({
  channel,
  directAgentId,
  directIdentity,
  directPresence,
  onContinueArtifact,
  onOpenProfile,
  activeView,
  onViewChange,
  user,
}: ConversationHeaderProps) {
  const [linkCopied, setLinkCopied] = useState(false);

  return (
    <header className="border-border/60 relative shrink-0 border-b">
      <div className="flex h-14 items-center px-5">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {directIdentity ? (
            <button
              type="button"
              aria-label={`Open ${directIdentity.name} profile`}
              title={`Open ${directIdentity.name} profile`}
              onClick={() => {
                if (directAgentId) {
                  onOpenProfile({
                    kind: "agent",
                    agentId: directAgentId,
                  });
                }
              }}
              className="focus-visible:ring-ring/30 rounded-full transition-opacity outline-none hover:opacity-85 focus-visible:ring-2"
            >
              <AgentPresenceAvatar
                name={directIdentity.name}
                presence={directPresence}
              />
            </button>
          ) : (
            <Hash size={17} className="text-muted-foreground shrink-0" />
          )}
          <div className="min-w-0">
            <h1
              className={cn(
                "truncate font-semibold",
                directIdentity
                  ? "text-sm leading-5 tracking-[-0.015em]"
                  : "text-[13px] leading-4",
              )}
            >
              {directIdentity?.name ?? channel.label}
            </h1>
            {!directIdentity ? (
              <p className="text-muted-foreground mt-0.5 truncate text-[12px] leading-4 font-normal">
                {channel.description}
              </p>
            ) : null}
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          {!directIdentity ? (
            <>
              <ChannelArtifactsMenu
                channelId={channel.id}
                onContinue={onContinueArtifact}
              />
              <ChannelMembersMenu
                channel={channel}
                user={user}
                onOpenProfile={onOpenProfile}
              />
            </>
          ) : null}
          <Popover>
            <PopoverTrigger asChild>
              <Button
                aria-label="Conversation actions"
                title="Conversation actions"
                variant="outline"
                size="icon-sm"
              >
                <MoreHorizontal size={15} />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-48 p-1.5">
              {directIdentity ? (
                <button
                  type="button"
                  onClick={() => {
                    if (directAgentId) {
                      onOpenProfile({
                        kind: "agent",
                        agentId: directAgentId,
                      });
                    }
                  }}
                  className="hover:bg-accent flex h-9 w-full items-center gap-2 rounded-lg px-2 text-left text-xs transition-colors"
                >
                  <UserRound size={14} />
                  View profile
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard.writeText(window.location.href);
                  setLinkCopied(true);
                  window.setTimeout(() => setLinkCopied(false), 1600);
                }}
                className="hover:bg-accent flex h-9 w-full items-center gap-2 rounded-lg px-2 text-left text-xs transition-colors"
              >
                {linkCopied ? <Check size={14} /> : <Copy size={14} />}
                {linkCopied
                  ? directIdentity
                    ? "Conversation link copied"
                    : "Channel link copied"
                  : directIdentity
                    ? "Copy conversation link"
                    : "Copy channel link"}
              </button>
            </PopoverContent>
          </Popover>
        </div>
      </div>
      {!directIdentity ? (
        <nav aria-label="Channel views" className="flex h-10 gap-1 px-5">
          {(
            [
              { id: "messages", label: "Messages" },
              { id: "canvas", label: "Canvas" },
            ] as const
          ).map((view) => (
            <button
              key={view.id}
              type="button"
              onClick={() => onViewChange(view.id)}
              className={cn(
                "text-muted-foreground hover:text-foreground relative flex h-full items-center px-2.5 text-[12px] leading-4 font-normal transition-colors",
                activeView === view.id && "text-foreground",
              )}
            >
              {view.label}
              {activeView === view.id ? (
                <span className="bg-foreground absolute right-2.5 bottom-0 left-2.5 h-px" />
              ) : null}
            </button>
          ))}
        </nav>
      ) : null}
    </header>
  );
}

function ChannelMembersMenu({
  channel,
  user,
  onOpenProfile,
}: {
  channel: ConversationHeaderChannel;
  user: ConversationHeaderProps["user"];
  onOpenProfile: ConversationHeaderProps["onOpenProfile"];
}) {
  const [open, setOpen] = useState(false);
  const selectProfile = (selection: ConversationProfileSelection) => {
    setOpen(false);
    onOpenProfile(selection);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`${channel.agentIds.length + 1} channel members`}
          title="Channel members"
          className="bg-card hover:bg-accent flex h-8 items-center rounded-lg px-2 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_8%,transparent)] transition-colors"
        >
          <span className="flex -space-x-1">
            {user?.image ? (
              <img
                src={user.image}
                alt=""
                className="ring-card size-4 rounded-full object-cover ring-1"
              />
            ) : null}
            {channel.agentIds.slice(0, 3).map((agentId) => (
              <AgentAvatar
                key={agentId}
                label={
                  WORKSPACE_AGENT_IDENTITIES[agentId as WorkspaceAgentId].name
                }
                className="ring-card size-4 ring-1"
              />
            ))}
          </span>
          <span className="text-muted-foreground ml-1.5 text-[10px]">
            {channel.agentIds.length + 1}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-1.5">
        <div className="px-2 pt-1.5 pb-2">
          <p className="text-xs font-medium">#{channel.label}</p>
          <p className="text-muted-foreground mt-0.5 text-[11px]">
            People and agents sharing this context.
          </p>
        </div>
        <div className="space-y-0.5">
          <button
            type="button"
            onClick={() => selectProfile({ kind: "user" })}
            className="hover:bg-accent flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors"
          >
            <span className="bg-muted flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-full text-[9px] font-medium">
              {user?.image ? (
                <img
                  src={user.image}
                  alt=""
                  className="size-full object-cover"
                />
              ) : (
                (user?.name.charAt(0) ?? "Y").toLocaleUpperCase()
              )}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-xs font-medium">
                {user?.name ?? "You"}
              </span>
              <span className="text-muted-foreground block text-[10px]">
                You
              </span>
            </span>
          </button>
          {channel.agentIds.map((agentId) => {
            const identity =
              WORKSPACE_AGENT_IDENTITIES[agentId as WorkspaceAgentId];
            return (
              <button
                key={agentId}
                type="button"
                onClick={() =>
                  selectProfile({
                    kind: "agent",
                    agentId: agentId as WorkspaceAgentId,
                  })
                }
                className="hover:bg-accent flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors"
              >
                <AgentAvatar label={identity.name} className="size-7" />
                <span className="min-w-0">
                  <span className="block truncate text-xs font-medium">
                    {identity.name}
                  </span>
                  <span className="text-muted-foreground block truncate text-[10px]">
                    {identity.role}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
