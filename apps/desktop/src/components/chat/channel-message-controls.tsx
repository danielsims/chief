import { useState } from "react";
import {
  Check,
  Copy,
  MessageCircle,
  MoreHorizontal,
  SmilePlus,
} from "lucide-react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@chief/ui/components/popover";
import { cn } from "@chief/ui/lib/utils";

import type { ChannelReactionSummary } from "../../lib/channel-reactions";
import { EMOJI_OPTIONS } from "./emoji-catalog";

const QUICK_REACTIONS = ["👍", "❤️", "😂"] as const;

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
  "text-muted-foreground hover:bg-accent hover:text-foreground flex size-8 items-center justify-center rounded-lg transition-colors outline-none focus-visible:bg-accent focus-visible:text-foreground";

export function ChannelMessageActions({
  text,
  onReply,
  onToggleReaction,
}: {
  text: string;
  onReply: () => void;
  onToggleReaction: (emoji: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const [reactionPickerOpen, setReactionPickerOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  return (
    <div className="bg-popover/95 ring-foreground/10 absolute -top-3 right-0 z-10 flex items-center gap-0.5 rounded-xl p-1 opacity-0 shadow-lg ring-1 backdrop-blur-md transition-opacity group-hover/message:opacity-100 focus-within:opacity-100">
      <button
        type="button"
        title="Reply in thread"
        aria-label="Reply in thread"
        onClick={onReply}
        className={actionButtonClass}
      >
        <MessageCircle size={15} />
      </button>
      {QUICK_REACTIONS.map((emoji) => (
        <button
          key={emoji}
          type="button"
          title={`React with ${emoji}`}
          aria-label={`React with ${emoji}`}
          onClick={() => onToggleReaction(emoji)}
          className={cn(actionButtonClass, "text-[15px]")}
        >
          {emoji}
        </button>
      ))}
      <Popover open={reactionPickerOpen} onOpenChange={setReactionPickerOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            title="Add reaction"
            aria-label="Add reaction"
            className={actionButtonClass}
          >
            <SmilePlus size={15} />
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" sideOffset={6} className="w-72 p-2.5">
          <p className="text-muted-foreground px-1 pb-2 text-[10px] font-medium">
            Add reaction
          </p>
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
      <Popover open={moreOpen} onOpenChange={setMoreOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            title="More actions"
            aria-label="More message actions"
            className={actionButtonClass}
          >
            <MoreHorizontal size={15} />
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" sideOffset={6} className="w-44 p-1.5">
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(text);
              setCopied(true);
              setMoreOpen(false);
              window.setTimeout(() => setCopied(false), 1400);
            }}
            className="hover:bg-accent flex h-9 w-full items-center gap-2 rounded-lg px-2 text-left text-xs transition-colors"
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? "Copied" : "Copy message"}
          </button>
          <button
            type="button"
            onClick={() => {
              setMoreOpen(false);
              onReply();
            }}
            className="hover:bg-accent flex h-9 w-full items-center gap-2 rounded-lg px-2 text-left text-xs transition-colors"
          >
            <MessageCircle size={14} /> Reply in thread
          </button>
        </PopoverContent>
      </Popover>
    </div>
  );
}

export function ChannelMessageMeta({
  replies,
  reactions,
  onOpenThread,
  onToggleReaction,
}: {
  replies: readonly {
    role: "system" | "user" | "assistant";
    metadata?: { createdAt?: number };
  }[];
  reactions: readonly ChannelReactionSummary[];
  onOpenThread: () => void;
  onToggleReaction: (emoji: string) => void;
}) {
  if (replies.length === 0 && reactions.length === 0) return null;
  const lastReply = replies.at(-1);

  return (
    <div className="mt-2 flex min-h-7 flex-wrap items-center gap-1.5">
      {reactions.map((reaction) => (
        <button
          key={reaction.emoji}
          type="button"
          title={reaction.names.join(", ")}
          aria-pressed={reaction.reacted}
          onClick={() => onToggleReaction(reaction.emoji)}
          className={cn(
            "hover:bg-accent flex h-7 items-center gap-1.5 rounded-lg px-2 text-xs shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_8%,transparent)] transition-colors",
            reaction.reacted &&
              "bg-foreground/[0.06] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_18%,transparent)]",
          )}
        >
          <span>{reaction.emoji}</span>
          <span className="text-muted-foreground text-[10px] tabular-nums">
            {reaction.count}
          </span>
        </button>
      ))}
      {replies.length > 0 ? (
        <button
          type="button"
          onClick={onOpenThread}
          className="hover:bg-accent flex h-8 items-center gap-2 rounded-lg px-1.5 pr-2.5 text-left transition-colors"
        >
          <span className="flex -space-x-1">
            {replies.slice(0, 3).map((reply, index) => (
              <span
                key={`${reply.role}-${index}`}
                className={cn(
                  "ring-background flex size-5 items-center justify-center rounded-full text-[7px] font-semibold ring-2",
                  reply.role === "assistant"
                    ? "bg-foreground text-background"
                    : "bg-muted text-muted-foreground",
                )}
              >
                {reply.role === "assistant" ? "C" : "Y"}
              </span>
            ))}
          </span>
          <span className="text-[11px] font-medium">
            {replies.length} {replies.length === 1 ? "reply" : "replies"}
          </span>
          <span className="text-muted-foreground text-[10px]">
            Last reply {relativeReplyTime(lastReply?.metadata?.createdAt)}
          </span>
        </button>
      ) : null}
    </div>
  );
}
