import { useState } from "react";
import { Hash, MessageSquarePlus, Pin, PinOff } from "lucide-react";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@chief/ui/components/context-menu";
import { cn } from "@chief/ui/lib/utils";

import type { WorkspaceChannelId } from "../lib/workspace-channels";
import { WORKSPACE_CHANNELS } from "../lib/workspace-channels";

const CHANNEL_DRAG_TYPE = "application/x-chief-channel";

interface ChannelRowProps {
  channelId: WorkspaceChannelId;
  active: boolean;
  count: number;
  pinned: boolean;
  draggable?: boolean;
  onOpen: () => void;
  onCreate: () => void;
  onPinChange: (pinned: boolean) => void;
}

function ChannelRow({
  channelId,
  active,
  count,
  pinned,
  draggable = false,
  onOpen,
  onCreate,
  onPinChange,
}: ChannelRowProps) {
  const channel = WORKSPACE_CHANNELS.find((item) => item.id === channelId);
  if (!channel) return null;

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <button
          type="button"
          draggable={draggable}
          onDragStart={(event) => {
            event.dataTransfer.effectAllowed = "copy";
            event.dataTransfer.setData(CHANNEL_DRAG_TYPE, channelId);
          }}
          onClick={onOpen}
          aria-current={active ? "page" : undefined}
          className={cn(
            "group/channel text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-foreground flex h-8 w-full min-w-0 items-center gap-2 rounded-lg px-2 text-left text-[13px] transition-colors",
            active && "bg-sidebar-accent text-sidebar-foreground font-medium",
            draggable && "cursor-grab active:cursor-grabbing",
          )}
        >
          <Hash size={14} strokeWidth={1.8} className="shrink-0 opacity-70" />
          <span className="min-w-0 flex-1 truncate">{channel.label}</span>
          {count > 1 ? (
            <span className="text-sidebar-muted text-[10px] tabular-nums opacity-70">
              {count}
            </span>
          ) : null}
        </button>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        <ContextMenuLabel>#{channel.label}</ContextMenuLabel>
        <ContextMenuItem onSelect={onOpen}>
          <Hash size={14} /> Open channel
        </ContextMenuItem>
        <ContextMenuItem onSelect={onCreate}>
          <MessageSquarePlus size={14} /> New conversation
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => onPinChange(!pinned)}>
          {pinned ? <PinOff size={14} /> : <Pin size={14} />}
          {pinned ? "Remove from pinned" : "Pin channel"}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

function GroupLabel({ children }: { children: string }) {
  return (
    <div className="text-sidebar-muted flex h-8 items-center px-2 text-[12px] font-semibold">
      {children}
    </div>
  );
}

export function SidebarChannels({
  activeChannelId,
  counts,
  pinnedIds,
  onOpen,
  onCreate,
  onPinnedChange,
}: {
  activeChannelId: WorkspaceChannelId | null;
  counts: Record<WorkspaceChannelId, number>;
  pinnedIds: WorkspaceChannelId[];
  onOpen: (channelId: WorkspaceChannelId) => void;
  onCreate: (channelId: WorkspaceChannelId) => void;
  onPinnedChange: (channelId: WorkspaceChannelId, pinned: boolean) => void;
}) {
  const [dropActive, setDropActive] = useState(false);
  const pinned = new Set(pinnedIds);

  return (
    <>
      <section
        className="mt-3 px-0.5"
        onDragEnter={(event) => {
          if (event.dataTransfer.types.includes(CHANNEL_DRAG_TYPE)) {
            setDropActive(true);
          }
        }}
        onDragOver={(event) => {
          if (!event.dataTransfer.types.includes(CHANNEL_DRAG_TYPE)) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
          setDropActive(true);
        }}
        onDragLeave={(event) => {
          if (
            !event.currentTarget.contains(event.relatedTarget as Node | null)
          ) {
            setDropActive(false);
          }
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDropActive(false);
          const channelId = event.dataTransfer.getData(
            CHANNEL_DRAG_TYPE,
          ) as WorkspaceChannelId;
          if (WORKSPACE_CHANNELS.some((channel) => channel.id === channelId)) {
            onPinnedChange(channelId, true);
          }
        }}
      >
        <GroupLabel>Pinned</GroupLabel>
        <div
          aria-hidden
          className={cn(
            "bg-foreground/70 mx-2 h-px origin-center transition-[transform,opacity] duration-150",
            dropActive ? "scale-x-100 opacity-100" : "scale-x-75 opacity-0",
          )}
        />
        <div className="space-y-0.5">
          {pinnedIds.map((channelId) => (
            <ChannelRow
              key={channelId}
              channelId={channelId}
              active={activeChannelId === channelId}
              count={counts[channelId]}
              pinned
              onOpen={() => onOpen(channelId)}
              onCreate={() => onCreate(channelId)}
              onPinChange={(next) => onPinnedChange(channelId, next)}
            />
          ))}
        </div>
      </section>

      <section className="mt-3 px-0.5">
        <GroupLabel>Channels</GroupLabel>
        <div className="space-y-0.5">
          {WORKSPACE_CHANNELS.map((channel) => (
            <ChannelRow
              key={channel.id}
              channelId={channel.id}
              active={activeChannelId === channel.id}
              count={counts[channel.id]}
              pinned={pinned.has(channel.id)}
              draggable
              onOpen={() => onOpen(channel.id)}
              onCreate={() => onCreate(channel.id)}
              onPinChange={(next) => onPinnedChange(channel.id, next)}
            />
          ))}
        </div>
      </section>
    </>
  );
}
