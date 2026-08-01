/* eslint-disable react-hooks/refs -- Dnd Kit exposes stable ref callbacks and reactive drag state through hook return objects. */
import type { CollisionDetection, DragEndEvent } from "@dnd-kit/core";
import type { ReactNode } from "react";
import { useState } from "react";
import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ArrowDownAZ,
  ChevronDown,
  Hash,
  MoreHorizontal,
  Pin,
  PinOff,
  Plus,
} from "lucide-react";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@chief/ui/components/context-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@chief/ui/components/popover";
import { cn } from "@chief/ui/lib/utils";

import type {
  WorkspaceAgentId,
  WorkspaceChannelId,
} from "../lib/workspace-channels";
import type { SidebarChannel } from "./channel-browser-dialog";
import { placePinnedChannel } from "../lib/workspace-channels";
import { ChannelBrowserDialog } from "./channel-browser-dialog";
import { SidebarDirectMessages } from "./sidebar-direct-messages";

const pinnedCollisionDetection: CollisionDetection = (args) => {
  if (!args.pointerCoordinates) return closestCenter(args);
  const collisions = pointerWithin(args);
  const pinnedRow = collisions.find((collision) =>
    String(collision.id).startsWith("pinned:"),
  );
  if (pinnedRow) return [pinnedRow];
  const pinnedSection = collisions.find(
    (collision) => collision.id === "pinned-drop",
  );
  return pinnedSection ? [pinnedSection] : [];
};

interface ChannelRowProps {
  channel: SidebarChannel;
  active: boolean;
  pinned: boolean;
  dragKind: "source" | "sortable";
  onOpen: () => void;
  onPinChange: (pinned: boolean) => void;
}

function ChannelContextActions({
  pinned,
  onOpen,
  onPinChange,
}: Pick<ChannelRowProps, "pinned" | "onOpen" | "onPinChange">) {
  return (
    <>
      <ContextMenuItem className="rounded-lg" onSelect={onOpen}>
        <Hash size={14} /> Open channel
      </ContextMenuItem>
      <ContextMenuItem
        className="rounded-lg"
        onSelect={() => onPinChange(!pinned)}
      >
        {pinned ? <PinOff size={14} /> : <Pin size={14} />}
        {pinned ? "Remove from pinned" : "Pin channel"}
      </ContextMenuItem>
    </>
  );
}

function ChannelPopoverActions({
  onOpen,
  onPinChange,
}: Pick<ChannelRowProps, "onOpen" | "onPinChange">) {
  return (
    <>
      <button
        type="button"
        className="hover:bg-accent flex h-9 w-full items-center gap-2 rounded-lg px-2 text-left text-xs transition-colors"
        onClick={onOpen}
      >
        <Hash size={14} /> Open channel
      </button>
      <button
        type="button"
        className="hover:bg-accent flex h-9 w-full items-center gap-2 rounded-lg px-2 text-left text-xs transition-colors"
        onClick={() => onPinChange(true)}
      >
        <Pin size={14} /> Pin channel
      </button>
    </>
  );
}

function ChannelRow({
  channel,
  active,
  pinned,
  dragKind,
  onOpen,
  onPinChange,
}: ChannelRowProps) {
  const channelId = channel.id;
  const [menuOpen, setMenuOpen] = useState(false);
  const source = useDraggable({
    id: `channel:${channelId}`,
    data: { channelId, dragKind: "source" },
    disabled: dragKind !== "source",
  });
  const sortable = useSortable({
    id: `pinned:${channelId}`,
    data: { channelId, dragKind: "sortable" },
    disabled: dragKind !== "sortable",
  });
  const drag = dragKind === "sortable" ? sortable : source;
  const style =
    dragKind === "sortable"
      ? {
          transform: CSS.Transform.toString(sortable.transform),
          transition: sortable.transition,
        }
      : undefined;

  return (
    <div
      ref={drag.setNodeRef}
      style={style}
      className={cn(
        "group/channel relative touch-none select-none",
        sortable.isOver &&
          "before:bg-sidebar-foreground before:absolute before:-top-px before:right-2 before:left-2 before:z-10 before:h-px",
        drag.isDragging && "z-20 opacity-45",
      )}
    >
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <button
            ref={drag.setActivatorNodeRef}
            {...drag.attributes}
            {...drag.listeners}
            type="button"
            onClick={onOpen}
            aria-current={active ? "page" : undefined}
            className={cn(
              "text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-foreground flex h-8 w-full min-w-0 cursor-grab touch-none items-center gap-2 rounded-lg px-2 pr-9 text-left text-[13px] transition-colors select-none active:cursor-grabbing",
              active && "bg-sidebar-accent text-sidebar-foreground font-medium",
              drag.isDragging && "cursor-grabbing",
            )}
          >
            <Hash size={14} strokeWidth={1.8} className="shrink-0 opacity-70" />
            <span className="min-w-0 flex-1 truncate">{channel.label}</span>
          </button>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-48 rounded-xl p-1.5 shadow-xl">
          <ChannelContextActions
            pinned={pinned}
            onOpen={onOpen}
            onPinChange={onPinChange}
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
            className="w-44 p-1.5"
            onOpenAutoFocus={(event) => event.preventDefault()}
          >
            <ChannelPopoverActions
              onOpen={() => {
                setMenuOpen(false);
                onOpen();
              }}
              onPinChange={(next) => {
                setMenuOpen(false);
                onPinChange(next);
              }}
            />
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}

function GroupLabel({
  children,
  collapsed,
  onToggle,
  actions,
}: {
  children: string;
  collapsed: boolean;
  onToggle: () => void;
  actions?: ReactNode;
}) {
  return (
    <div className="group/heading flex h-8 items-center px-2">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!collapsed}
        className="text-sidebar-muted hover:text-sidebar-foreground flex min-w-0 flex-1 items-center gap-1.5 text-left text-xs font-semibold transition-colors"
      >
        <span className="truncate">{children}</span>
        <ChevronDown
          size={13}
          strokeWidth={1.8}
          className={cn(
            "opacity-0 transition-[opacity,transform] group-hover/heading:opacity-100 group-focus-visible/heading:opacity-100",
            collapsed && "-rotate-90",
          )}
        />
      </button>
      {actions ? (
        <div className="flex items-center opacity-0 transition-opacity group-hover/heading:opacity-100 focus-within:opacity-100">
          {actions}
        </div>
      ) : null}
    </div>
  );
}

export function SidebarChannels({
  channels,
  activeChannelId,
  activeAgentId,
  directMessageIds,
  pinnedIds,
  onOpen,
  onOpenDirectMessage,
  onCreateChannel,
  onPinnedChange,
}: {
  channels: SidebarChannel[];
  activeChannelId: WorkspaceChannelId | null;
  activeAgentId: WorkspaceAgentId | null;
  directMessageIds: WorkspaceAgentId[];
  pinnedIds: WorkspaceChannelId[];
  onOpen: (channelId: WorkspaceChannelId) => void;
  onOpenDirectMessage: (agentId: WorkspaceAgentId) => void;
  onCreateChannel: (name: string, description?: string) => void;
  onPinnedChange: (pinnedIds: WorkspaceChannelId[]) => void;
}) {
  const [pinnedCollapsed, setPinnedCollapsed] = useState(false);
  const [channelsCollapsed, setChannelsCollapsed] = useState(false);
  const [channelBrowserOpen, setChannelBrowserOpen] = useState(false);
  const [channelSort, setChannelSort] = useState<"default" | "az">("default");
  const [draggingId, setDraggingId] = useState<WorkspaceChannelId | null>(null);
  const pinned = new Set(pinnedIds);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const pinnedDrop = useDroppable({ id: "pinned-drop" });

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    setDraggingId(null);
    if (!over) return;
    const channelId = active.data.current?.channelId as
      WorkspaceChannelId | undefined;
    if (!channelId) return;
    const overChannelId = over.data.current?.channelId as
      WorkspaceChannelId | undefined;
    onPinnedChange(
      placePinnedChannel(pinnedIds, channelId, overChannelId ?? null),
    );
    setPinnedCollapsed(false);
  };

  const setPinned = (channelId: WorkspaceChannelId, next: boolean) => {
    onPinnedChange(
      next
        ? [...pinnedIds, channelId]
        : pinnedIds.filter((id) => id !== channelId),
    );
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pinnedCollisionDetection}
      onDragStart={({ active }) => {
        const channelId = active.data.current?.channelId as
          WorkspaceChannelId | undefined;
        setDraggingId(channelId ?? null);
      }}
      onDragCancel={() => setDraggingId(null)}
      onDragEnd={onDragEnd}
    >
      {pinnedIds.length > 0 ? (
        <section
          ref={pinnedDrop.setNodeRef}
          className={cn(
            "mt-3 rounded-lg px-0.5 transition-colors",
            pinnedDrop.isOver && "bg-sidebar-accent/45",
          )}
        >
          <GroupLabel
            collapsed={pinnedCollapsed}
            onToggle={() => setPinnedCollapsed((current) => !current)}
          >
            Pinned
          </GroupLabel>
          {!pinnedCollapsed ? (
            <div
              className={cn(
                "min-h-2 rounded-lg py-0.5 transition-shadow",
                pinnedDrop.isOver &&
                  "shadow-[inset_0_1px_0_var(--sidebar-foreground)]",
              )}
            >
              <SortableContext
                items={pinnedIds.map((id) => `pinned:${id}`)}
                strategy={verticalListSortingStrategy}
              >
                <div className="space-y-0.5">
                  {pinnedIds.map((channelId) => {
                    const channel = channels.find(
                      (candidate) => candidate.id === channelId,
                    );
                    return channel ? (
                      <ChannelRow
                        key={channelId}
                        channel={channel}
                        active={activeChannelId === channelId}
                        pinned
                        dragKind="sortable"
                        onOpen={() => onOpen(channelId)}
                        onPinChange={(next) => setPinned(channelId, next)}
                      />
                    ) : null;
                  })}
                </div>
              </SortableContext>
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="mt-3 px-0.5">
        <GroupLabel
          collapsed={channelsCollapsed}
          onToggle={() => setChannelsCollapsed((current) => !current)}
          actions={
            <>
              <button
                type="button"
                aria-label="Browse or create channels"
                title="Browse channels"
                onClick={() => setChannelBrowserOpen(true)}
                className="text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-foreground flex size-6 items-center justify-center rounded-md"
              >
                <Plus size={13} />
              </button>
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    aria-label="Channel list options"
                    title="Channel list options"
                    className="text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-foreground flex size-6 items-center justify-center rounded-md"
                  >
                    <MoreHorizontal size={13} />
                  </button>
                </PopoverTrigger>
                <PopoverContent
                  side="right"
                  align="start"
                  className="w-48 p-1.5"
                >
                  <button
                    type="button"
                    onClick={() => setChannelSort("az")}
                    className="hover:bg-accent flex h-9 w-full items-center gap-2 rounded-lg px-2 text-left text-xs"
                  >
                    <ArrowDownAZ size={14} /> Sort alphabetically
                  </button>
                  <button
                    type="button"
                    onClick={() => setChannelSort("default")}
                    className="hover:bg-accent flex h-9 w-full items-center gap-2 rounded-lg px-2 text-left text-xs"
                  >
                    <Hash size={14} /> Workspace order
                  </button>
                </PopoverContent>
              </Popover>
            </>
          }
        >
          Channels
        </GroupLabel>
        {!channelsCollapsed ? (
          <div className="space-y-0.5">
            {[...channels]
              .sort((a, b) =>
                channelSort === "az" ? a.label.localeCompare(b.label) : 0,
              )
              .filter((channel) => !pinned.has(channel.id))
              .map((channel) => (
                <ChannelRow
                  key={channel.id}
                  channel={channel}
                  active={activeChannelId === channel.id}
                  pinned={false}
                  dragKind="source"
                  onOpen={() => onOpen(channel.id)}
                  onPinChange={(next) => setPinned(channel.id, next)}
                />
              ))}
          </div>
        ) : null}
      </section>
      <SidebarDirectMessages
        activeAgentId={activeAgentId}
        directMessageIds={directMessageIds}
        onOpen={onOpenDirectMessage}
      />
      <DragOverlay dropAnimation={{ duration: 160, easing: "ease-out" }}>
        {draggingId ? (
          <div className="bg-sidebar-accent text-sidebar-foreground flex h-8 w-52 items-center gap-2 rounded-lg px-2 text-[13px] shadow-xl ring-1 ring-black/10 dark:ring-white/10">
            <Hash size={14} strokeWidth={1.8} className="opacity-70" />
            <span className="truncate">
              {channels.find((channel) => channel.id === draggingId)?.label ??
                draggingId}
            </span>
          </div>
        ) : null}
      </DragOverlay>
      <ChannelBrowserDialog
        channels={channels}
        open={channelBrowserOpen}
        onOpenChange={setChannelBrowserOpen}
        onOpenChannel={onOpen}
        onCreateChannel={onCreateChannel}
      />
    </DndContext>
  );
}
