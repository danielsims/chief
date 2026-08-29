import { useState } from "react";
import { useDraggable } from "@dnd-kit/core";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Hash, Lock, MoreHorizontal, PinOff } from "lucide-react";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "@chief/ui/components/context-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@chief/ui/components/popover";
import { cn } from "@chief/ui/lib/utils";

import type { SidebarPinnedItem } from "../lib/workspace-channels";
import type { SidebarChannel } from "./channel-browser-dialog";
import { sidebarPinnedItemKey } from "../lib/workspace-channels";
import { AttentionPill } from "./attention-pill";
import {
  ChannelContextActions,
  ChannelPopoverActions,
} from "./sidebar-channel-actions";

interface ChannelRowProps {
  canDelete: boolean;
  compactAttention: boolean;
  channel: SidebarChannel;
  active: boolean;
  pinned: boolean;
  needsUser: boolean;
  unreadCount: number;
  dragKind: "source" | "sortable";
  onOpen: () => void;
  onDelete: () => void;
  onLeave: () => void;
  onPinChange: (pinned: boolean) => void;
  onSearch: () => void;
  onViewDetails: () => void;
}

export function ChannelRow({
  canDelete,
  compactAttention,
  channel,
  active,
  pinned,
  needsUser,
  unreadCount,
  dragKind,
  onDelete,
  onLeave,
  onOpen,
  onPinChange,
  onSearch,
  onViewDetails,
}: ChannelRowProps) {
  const channelId = channel.id;
  const item = { kind: "channel", id: channelId } satisfies SidebarPinnedItem;
  const [menuOpen, setMenuOpen] = useState(false);
  const source = useDraggable({
    id: `source:${sidebarPinnedItemKey(item)}`,
    data: { pin: item },
    disabled: dragKind !== "source",
  });
  const sortable = useSortable({
    id: `pinned:${sidebarPinnedItemKey(item)}`,
    data: { pin: item },
    disabled: dragKind !== "sortable",
  });
  const {
    attributes: sourceAttributes,
    isDragging: sourceIsDragging,
    listeners: sourceListeners,
    setActivatorNodeRef: setSourceActivatorNodeRef,
    setNodeRef: setSourceNodeRef,
  } = source;
  const {
    attributes: sortableAttributes,
    isDragging: sortableIsDragging,
    isOver: sortableIsOver,
    listeners: sortableListeners,
    setActivatorNodeRef: setSortableActivatorNodeRef,
    setNodeRef: setSortableNodeRef,
    transform: sortableTransform,
    transition: sortableTransition,
  } = sortable;
  const isSortable = dragKind === "sortable";
  const setNodeRef = isSortable ? setSortableNodeRef : setSourceNodeRef;
  const setActivatorNodeRef = isSortable
    ? setSortableActivatorNodeRef
    : setSourceActivatorNodeRef;
  const dragAttributes = isSortable ? sortableAttributes : sourceAttributes;
  const dragListeners = isSortable ? sortableListeners : sourceListeners;
  const isDragging = isSortable ? sortableIsDragging : sourceIsDragging;
  const style = isSortable
    ? {
        transform: CSS.Transform.toString(sortableTransform),
        transition: sortableTransition,
      }
    : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "group/channel relative touch-none select-none",
        sortableIsOver &&
          "before:bg-sidebar-foreground before:absolute before:-top-px before:right-2 before:left-2 before:z-10 before:h-px",
        isDragging && "z-20 opacity-45",
      )}
    >
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <button
            ref={setActivatorNodeRef}
            {...dragAttributes}
            {...dragListeners}
            type="button"
            onClick={onOpen}
            aria-current={active ? "page" : undefined}
            className={cn(
              "text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-foreground flex h-8 w-full min-w-0 cursor-grab touch-none items-center gap-2 rounded-lg px-2 text-left text-[13px] transition-[padding,color,background-color] select-none active:cursor-grabbing",
              needsUser
                ? menuOpen
                  ? "pr-9"
                  : "pr-2 group-focus-within/channel:pr-9 group-hover/channel:pr-9"
                : "pr-9",
              active && "bg-sidebar-accent text-sidebar-foreground font-medium",
              !active &&
                unreadCount > 0 &&
                "text-sidebar-foreground font-semibold",
              isDragging && "cursor-grabbing",
            )}
          >
            {channel.visibility === "private" ? (
              <Lock
                size={14}
                strokeWidth={1.8}
                className="shrink-0 opacity-70"
              />
            ) : (
              <Hash
                size={14}
                strokeWidth={1.8}
                className="shrink-0 opacity-70"
              />
            )}
            <span className="min-w-0 flex-1 truncate">{channel.label}</span>
            {needsUser || unreadCount > 0 ? (
              <span className="ml-auto flex shrink-0 items-center gap-1.5">
                {needsUser ? (
                  <AttentionPill compact={compactAttention} />
                ) : null}
                {unreadCount > 0 ? (
                  <span
                    aria-label={`${unreadCount} unread ${unreadCount === 1 ? "message" : "messages"}`}
                    className="bg-sidebar-foreground/10 text-sidebar-foreground min-w-5 rounded-full px-1.5 text-center text-[10px] leading-5 font-semibold tabular-nums"
                  >
                    {unreadCount > 99 ? "99+" : unreadCount}
                  </span>
                ) : null}
              </span>
            ) : null}
          </button>
        </ContextMenuTrigger>
        <ContextMenuContent className="border-border/60 min-w-60 rounded-xl bg-[color-mix(in_srgb,var(--background)_80%,var(--muted)_20%)] p-1 shadow-[0_6px_18px_rgb(0_0_0/0.02),0_3px_9px_rgb(0_0_0/0.04),0_1px_1px_rgb(0_0_0/0.04)] backdrop-blur-none">
          <ChannelContextActions
            canDelete={canDelete}
            pinned={pinned}
            channel={channel}
            onDelete={onDelete}
            onLeave={onLeave}
            onPinChange={onPinChange}
            onSearch={onSearch}
            onViewDetails={onViewDetails}
          />
        </ContextMenuContent>
      </ContextMenu>
      {pinned ? (
        <button
          type="button"
          aria-label={`Unpin ${channel.label}`}
          title="Remove from pinned"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            onPinChange(false);
          }}
          className="text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-foreground pointer-events-none absolute top-1 right-1 flex size-6 items-center justify-center rounded-md opacity-0 transition-[opacity,color,background-color] group-hover/channel:pointer-events-auto group-hover/channel:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100 focus-visible:outline-none"
        >
          <PinOff size={13} strokeWidth={1.8} />
        </button>
      ) : (
        <Popover open={menuOpen} onOpenChange={setMenuOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={`More options for ${channel.label}`}
              title="Channel options"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
              className="text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-foreground pointer-events-none absolute top-1 right-1 flex size-6 items-center justify-center rounded-md opacity-0 transition-[opacity,color,background-color] group-hover/channel:pointer-events-auto group-hover/channel:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100 focus-visible:outline-none data-[state=open]:pointer-events-auto data-[state=open]:opacity-100"
            >
              <MoreHorizontal size={14} strokeWidth={1.8} />
            </button>
          </PopoverTrigger>
          <PopoverContent
            side="right"
            align="start"
            sideOffset={8}
            className="border-border/60 w-60 rounded-xl bg-[color-mix(in_srgb,var(--background)_80%,var(--muted)_20%)] p-1 shadow-[0_6px_18px_rgb(0_0_0/0.02),0_3px_9px_rgb(0_0_0/0.04),0_1px_1px_rgb(0_0_0/0.04)] backdrop-blur-none"
            onOpenAutoFocus={(event) => event.preventDefault()}
          >
            <ChannelPopoverActions
              canDelete={canDelete}
              channel={channel}
              onDelete={() => {
                setMenuOpen(false);
                window.setTimeout(onDelete, 0);
              }}
              onLeave={() => {
                setMenuOpen(false);
                window.setTimeout(onLeave, 0);
              }}
              onPinChange={(next) => {
                setMenuOpen(false);
                onPinChange(next);
              }}
              onSearch={() => {
                setMenuOpen(false);
                window.setTimeout(onSearch, 0);
              }}
              onViewDetails={() => {
                setMenuOpen(false);
                window.setTimeout(onViewDetails, 0);
              }}
            />
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}
