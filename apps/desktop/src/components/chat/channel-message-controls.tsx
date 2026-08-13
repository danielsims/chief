import type { ReactElement } from "react";
import { useState } from "react";
import {
  Check,
  CircleAlert,
  Copy,
  CornerUpLeft,
  Link2,
  MoreVertical,
  SmilePlus,
} from "lucide-react";

import type { SessionRecord } from "@chief/agent-runtime/types";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@chief/ui/components/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@chief/ui/components/tooltip";
import { cn } from "@chief/ui/lib/utils";

import type { ChannelReactionSummary } from "../../lib/channel-reactions";
import { AgentAvatar } from "../agent-avatar";
import { EMOJI_OPTIONS } from "./emoji-catalog";
import {
  specialistIsStartingOrWorking,
  SpecialistStatusIndicator,
} from "./specialist-status-indicator";

const QUICK_REACTIONS = [
  { emoji: "💬", label: "React with speech balloon" },
  { emoji: "👍", label: "React with thumbs up" },
  { emoji: "❤️", label: "React with heart" },
  { emoji: "😂", label: "React with tears of joy" },
] as const;

function relativeReplyTime(createdAt: number | undefined) {
  if (!createdAt) return "recently";
  const elapsed = Math.max(0, Date.now() - createdAt);
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

const actionButtonClass =
  "text-muted-foreground hover:bg-muted hover:text-foreground flex size-8 items-center justify-center rounded-full transition-colors outline-none focus-visible:bg-muted focus-visible:text-foreground focus-visible:ring-1 focus-visible:ring-ring";

const menuItemClass =
  "hover:bg-muted/50 focus-visible:bg-muted/50 flex min-h-9 w-full items-center gap-2 rounded-lg py-2 pl-2 pr-4 text-left text-sm font-normal leading-5 tracking-[-0.006em] transition-colors outline-none [&_svg]:size-4 [&_svg]:shrink-0";

function MessageActionTooltip({
  children,
  label,
}: {
  children: ReactElement;
  label: string;
}) {
  return (
    <Tooltip delayDuration={300} disableHoverableContent>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="top" sideOffset={10}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

export function ChannelMessageActions({
  text,
  onReply,
  onToggleReaction,
}: {
  text: string;
  onReply: () => void;
  onToggleReaction: (emoji: string) => void;
}) {
  const [copied, setCopied] = useState<"message" | "link" | null>(null);
  const [reactionPickerOpen, setReactionPickerOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  return (
    <div className="bg-background/95 border-border/70 absolute -top-3 right-0 z-10 flex items-center gap-0.5 overflow-hidden rounded-full border p-1 opacity-0 shadow-sm backdrop-blur-sm transition-opacity group-hover/message:opacity-100 focus-within:opacity-100">
      {QUICK_REACTIONS.map(({ emoji, label }) => (
        <MessageActionTooltip key={emoji} label={label}>
          <button
            type="button"
            aria-label={label}
            onClick={() => onToggleReaction(emoji)}
            className={cn(actionButtonClass, "text-[15px]")}
          >
            {emoji}
          </button>
        </MessageActionTooltip>
      ))}
      <span aria-hidden="true" className="bg-border/70 mx-0.5 h-4 w-px" />
      <Popover open={reactionPickerOpen} onOpenChange={setReactionPickerOpen}>
        <MessageActionTooltip label="Find another reaction">
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label="Find another reaction"
              className={actionButtonClass}
            >
              <SmilePlus size={15} />
            </button>
          </PopoverTrigger>
        </MessageActionTooltip>
        <PopoverContent align="end" sideOffset={6} className="w-72 p-2.5">
          <div className="grid grid-cols-8 gap-0.5">
            {EMOJI_OPTIONS.map((option) => (
              <button
                key={option.shortcode}
                type="button"
                title={`:${option.shortcode}:`}
                aria-label={`React with ${option.shortcode}`}
                onClick={() => {
                  onToggleReaction(option.emoji);
                  setReactionPickerOpen(false);
                }}
                className="hover:bg-accent flex size-8 items-center justify-center rounded-lg text-lg transition-colors"
              >
                {option.emoji}
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>
      <MessageActionTooltip label="Reply in thread">
        <button
          type="button"
          aria-label="Reply in thread"
          onClick={onReply}
          className={actionButtonClass}
        >
          <CornerUpLeft size={16} />
        </button>
      </MessageActionTooltip>
      <Popover open={moreOpen} onOpenChange={setMoreOpen}>
        <MessageActionTooltip label="More actions">
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label="More message actions"
              className={actionButtonClass}
            >
              <MoreVertical size={16} />
            </button>
          </PopoverTrigger>
        </MessageActionTooltip>
        <PopoverContent
          align="end"
          side="top"
          sideOffset={6}
          className="w-60 rounded-xl p-1"
        >
          <button
            type="button"
            onClick={() => {
              setMoreOpen(false);
              onReply();
            }}
            className={menuItemClass}
          >
            <CornerUpLeft /> Reply
          </button>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(text);
              setCopied("message");
              setMoreOpen(false);
              window.setTimeout(() => setCopied(null), 1400);
            }}
            className={menuItemClass}
          >
            {copied === "message" ? <Check /> : <Copy />}
            {copied === "message" ? "Message copied" : "Copy message"}
          </button>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(window.location.href);
              setCopied("link");
              setMoreOpen(false);
              window.setTimeout(() => setCopied(null), 1400);
            }}
            className={menuItemClass}
          >
            {copied === "link" ? <Check /> : <Link2 />}
            {copied === "link" ? "Link copied" : "Copy conversation link"}
          </button>
        </PopoverContent>
      </Popover>
    </div>
  );
}

export function ChannelMessageMeta({
  replies,
  replyCount = replies.length,
  lastReplyAt,
  participants,
  reactions,
  onOpenThread,
  onToggleReaction,
  specialist,
  needsUser = false,
}: {
  replies: readonly {
    role: "system" | "user" | "assistant";
    metadata?: { createdAt?: number };
  }[];
  replyCount?: number;
  lastReplyAt?: number;
  participants: readonly ThreadParticipant[];
  reactions: readonly ChannelReactionSummary[];
  onOpenThread: () => void;
  onToggleReaction: (emoji: string) => void;
  specialist?: SessionRecord;
  needsUser?: boolean;
}) {
  if (replyCount === 0 && reactions.length === 0 && !specialist) return null;
  const lastReply = replies.at(-1);
  const effectiveReplyCount = Math.max(replyCount, specialist ? 1 : 0);
  const latestReplyAt =
    lastReplyAt ?? lastReply?.metadata?.createdAt ?? specialist?.updatedAt;
  const uniqueParticipants = participants.filter(
    (participant, index) =>
      participants.findIndex((candidate) => candidate.id === participant.id) ===
      index,
  );

  return (
    <div className="mt-2 flex flex-col items-start gap-1.5">
      {reactions.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {reactions.map((reaction) => (
            <button
              key={reaction.emoji}
              type="button"
              title={reaction.names.join(", ")}
              aria-label={`Toggle ${reaction.emoji} reaction`}
              aria-pressed={reaction.reacted}
              onClick={() => onToggleReaction(reaction.emoji)}
              className={cn(
                "bg-muted/70 text-foreground/90 hover:bg-foreground/[0.07] focus-visible:ring-ring inline-flex h-7 min-w-12 items-center justify-center gap-1.5 rounded-full px-2 text-xs leading-none font-medium shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_10%,transparent)] transition-[background-color,box-shadow,color] outline-none focus-visible:ring-2",
                reaction.reacted &&
                  "bg-foreground/[0.07] text-foreground shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_22%,transparent)]",
              )}
            >
              <span className="inline-flex size-3.5 items-center justify-center text-xs leading-none">
                {reaction.emoji}
              </span>
              <span className="text-muted-foreground translate-y-px text-[10px] leading-none tabular-nums">
                {reaction.count}
              </span>
            </button>
          ))}
        </div>
      ) : null}
      {effectiveReplyCount > 0 ? (
        <button
          type="button"
          onClick={onOpenThread}
          className="hover:bg-accent flex h-8 items-center gap-2 rounded-lg px-1.5 pr-2.5 text-left transition-colors"
        >
          <span className="flex -space-x-1">
            {specialist &&
            specialistIsStartingOrWorking(specialist.status) &&
            specialist.status !== "waiting" ? (
              <span className="bg-background ring-background relative z-[1] grid size-5 place-items-center rounded-md ring-2">
                <SpecialistStatusIndicator
                  agent={specialist.agent}
                  status={specialist.status}
                  className="size-4"
                />
              </span>
            ) : null}
            {uniqueParticipants.slice(0, 3).map((participant) =>
              participant.kind === "agent" ? (
                <AgentAvatar
                  key={participant.id}
                  label={participant.name}
                  className="ring-background size-5 rounded-md ring-2"
                />
              ) : (
                <span
                  key={participant.id}
                  title={participant.name}
                  className="bg-muted text-muted-foreground ring-background flex size-5 items-center justify-center overflow-hidden rounded-md text-[7px] font-semibold ring-2"
                >
                  {participant.image ? (
                    <img
                      src={participant.image}
                      alt=""
                      className="size-full object-cover"
                    />
                  ) : (
                    participant.name
                      .split(/\s+/u)
                      .map((part) => part.charAt(0))
                      .join("")
                      .slice(0, 2)
                      .toLocaleUpperCase()
                  )}
                </span>
              ),
            )}
            {uniqueParticipants.length > 3 ? (
              <span className="bg-muted text-muted-foreground ring-background flex size-5 items-center justify-center rounded-md text-[7px] font-medium ring-2">
                +{uniqueParticipants.length - 3}
              </span>
            ) : null}
          </span>
          <span className="text-xs font-medium">
            {effectiveReplyCount}{" "}
            {effectiveReplyCount === 1 ? "reply" : "replies"}
          </span>
          <span className="text-muted-foreground text-xs">
            Last reply {relativeReplyTime(latestReplyAt)}
          </span>
          {needsUser ? (
            <span className="flex items-center gap-1 text-xs font-medium text-amber-300">
              <CircleAlert aria-hidden size={13} strokeWidth={2} />
              Needs you
            </span>
          ) : null}
        </button>
      ) : null}
    </div>
  );
}

export interface ThreadParticipant {
  id: string;
  kind: "agent" | "user";
  name: string;
  image?: string;
}
