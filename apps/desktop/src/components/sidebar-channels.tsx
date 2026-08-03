/* eslint-disable react-hooks/refs -- Dnd Kit exposes stable ref callbacks and reactive drag state through hook return objects. */
/* eslint-disable max-lines */
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
  PinOff,
  Plus,
} from "lucide-react";

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

import type {
  SidebarPinnedItem,
  WorkspaceAgentId,
  WorkspaceChannelId,
} from "../lib/workspace-channels";
import type { SidebarChannel } from "./channel-browser-dialog";
import {
  placeSidebarPinnedItem,
  sidebarPinnedItemKey,
  WORKSPACE_AGENT_IDENTITIES,
} from "../lib/workspace-channels";
import { AgentAvatar } from "./agent-avatar";
import { ChannelBrowserDialog } from "./channel-browser-dialog";
import { ChannelDetailsDialog } from "./channel-details-dialog";
import {
  ChannelContextActions,
  ChannelDeleteDialog,
  ChannelPopoverActions,
} from "./sidebar-channel-actions";
import {
  DirectMessageRow,
  SidebarDirectMessages,
} from "./sidebar-direct-messages";
import { openWorkspaceSearch } from "./workspace-search";

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
  canDelete: boolean;
  channel: SidebarChannel;
  active: boolean;
  pinned: boolean;
  unreadCount: number;
  dragKind: "source" | "sortable";
  onOpen: () => void;
  onDelete: () => void;
  onLeave: () => void;
  onPinChange: (pinned: boolean) => void;
  onSearch: () => void;
  onViewDetails: () => void;
}

function ChannelRow({
  canDelete,
  channel,
  active,
  pinned,
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
              !active &&
                unreadCount > 0 &&
                "text-sidebar-foreground font-semibold",
              drag.isDragging && "cursor-grabbing",
            )}
          >
            <Hash size={14} strokeWidth={1.8} className="shrink-0 opacity-70" />
            <span className="min-w-0 flex-1 truncate">{channel.label}</span>
            {unreadCount > 0 ? (
              <span
                aria-label={`${unreadCount} unread ${unreadCount === 1 ? "message" : "messages"}`}
                className="bg-sidebar-foreground/10 text-sidebar-foreground ml-auto min-w-5 rounded-full px-1.5 text-center text-[10px] leading-5 font-semibold tabular-nums"
              >
                {unreadCount > 99 ? "99+" : unreadCount}
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
  canDeleteChannels,
  canManageChannels,
  channels,
  allChannels = channels,
  activeChannelId,
  activeAgentId,
  directMessageIds,
  pinnedItems,
  unreadChannelCounts,
  unreadDirectMessageCounts,
  onOpen,
  onOpenDirectMessage,
  onCreateChannel,
  onDeleteChannel,
  onUpdateChannel,
  onLeaveChannel,
  onPinnedChange,
}: {
  canDeleteChannels: boolean;
  canManageChannels: boolean;
  channels: SidebarChannel[];
  allChannels?: SidebarChannel[];
  activeChannelId: WorkspaceChannelId | null;
  activeAgentId: WorkspaceAgentId | null;
  directMessageIds: WorkspaceAgentId[];
  pinnedItems: SidebarPinnedItem[];
  unreadChannelCounts: ReadonlyMap<string, number>;
  unreadDirectMessageCounts: ReadonlyMap<WorkspaceAgentId, number>;
  onOpen: (
    channelId: WorkspaceChannelId,
    options?: { focusComposer?: boolean },
  ) => void;
  onOpenDirectMessage: (agentId: WorkspaceAgentId) => void;
  onCreateChannel: (
    name: string,
    description?: string,
  ) => Promise<WorkspaceChannelId | null>;
  onDeleteChannel: (channelId: WorkspaceChannelId) => Promise<void>;
  onUpdateChannel: (
    channelId: WorkspaceChannelId,
    input: { name: string; topic: string; description: string },
  ) => Promise<void>;
  onLeaveChannel: (channelId: WorkspaceChannelId) => Promise<void>;
  onPinnedChange: (pinnedItems: SidebarPinnedItem[]) => void;
}) {
  const [pinnedCollapsed, setPinnedCollapsed] = useState(false);
  const [channelsCollapsed, setChannelsCollapsed] = useState(false);
  const [channelBrowserOpen, setChannelBrowserOpen] = useState(false);
  const [channelSort, setChannelSort] = useState<"default" | "az">("default");
  const [draggingItem, setDraggingItem] = useState<SidebarPinnedItem | null>(
    null,
  );
  const [deleteTarget, setDeleteTarget] = useState<SidebarChannel | null>(null);
  const [detailsTarget, setDetailsTarget] = useState<SidebarChannel | null>(
    null,
  );
  const pinnedChannels = new Set(
    pinnedItems
      .filter((item) => item.kind === "channel")
      .map((item) => item.id),
  );
  const pinnedAgentIds = pinnedItems.flatMap((item) =>
    item.kind === "agent" ? [item.id] : [],
  );
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const pinnedDrop = useDroppable({ id: "pinned-drop" });

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    setDraggingItem(null);
    if (!over) return;
    const item = active.data.current?.pin as SidebarPinnedItem | undefined;
    if (!item) return;
    const overItem = over.data.current?.pin as SidebarPinnedItem | undefined;
    onPinnedChange(placeSidebarPinnedItem(pinnedItems, item, overItem ?? null));
    setPinnedCollapsed(false);
  };

  const setPinned = (channelId: WorkspaceChannelId, next: boolean) => {
    const item = { kind: "channel", id: channelId } satisfies SidebarPinnedItem;
    onPinnedChange(
      next
        ? placeSidebarPinnedItem(pinnedItems, item, null)
        : pinnedItems.filter(
            (candidate) =>
              sidebarPinnedItemKey(candidate) !== sidebarPinnedItemKey(item),
          ),
    );
  };

  const setAgentPinned = (agentId: WorkspaceAgentId, next: boolean) => {
    const item = { kind: "agent", id: agentId } satisfies SidebarPinnedItem;
    onPinnedChange(
      next
        ? placeSidebarPinnedItem(pinnedItems, item, null)
        : pinnedItems.filter(
            (candidate) =>
              sidebarPinnedItemKey(candidate) !== sidebarPinnedItemKey(item),
          ),
    );
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pinnedCollisionDetection}
      onDragStart={({ active }) => {
        const item = active.data.current?.pin as SidebarPinnedItem | undefined;
        setDraggingItem(item ?? null);
      }}
      onDragCancel={() => setDraggingItem(null)}
      onDragEnd={onDragEnd}
    >
      {pinnedItems.length > 0 ? (
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
                items={pinnedItems.map(
                  (item) => `pinned:${sidebarPinnedItemKey(item)}`,
                )}
                strategy={verticalListSortingStrategy}
              >
                <div className="space-y-0.5">
                  {pinnedItems.map((item) => {
                    if (item.kind === "agent") {
                      return (
                        <DirectMessageRow
                          key={sidebarPinnedItemKey(item)}
                          active={activeAgentId === item.id}
                          agentId={item.id}
                          dragKind="sortable"
                          onOpen={() => onOpenDirectMessage(item.id)}
                          onPinChange={(next) => setAgentPinned(item.id, next)}
                          pinned
                          unreadCount={
                            unreadDirectMessageCounts.get(item.id) ?? 0
                          }
                        />
                      );
                    }
                    const channel = channels.find(
                      (candidate) => candidate.id === item.id,
                    );
                    return channel ? (
                      <ChannelRow
                        key={sidebarPinnedItemKey(item)}
                        canDelete={canDeleteChannels}
                        channel={channel}
                        active={activeChannelId === item.id}
                        pinned
                        unreadCount={unreadChannelCounts.get(item.id) ?? 0}
                        dragKind="sortable"
                        onDelete={() => setDeleteTarget(channel)}
                        onLeave={() => void onLeaveChannel(item.id)}
                        onOpen={() => onOpen(item.id)}
                        onPinChange={(next) => setPinned(item.id, next)}
                        onSearch={() =>
                          openWorkspaceSearch({
                            channelId: channel.id,
                            channelLabel: channel.label,
                          })
                        }
                        onViewDetails={() => setDetailsTarget(channel)}
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
              .filter((channel) => !pinnedChannels.has(channel.id))
              .map((channel) => (
                <ChannelRow
                  key={channel.id}
                  canDelete={canDeleteChannels}
                  channel={channel}
                  active={activeChannelId === channel.id}
                  pinned={false}
                  unreadCount={unreadChannelCounts.get(channel.id) ?? 0}
                  dragKind="source"
                  onDelete={() => setDeleteTarget(channel)}
                  onLeave={() => void onLeaveChannel(channel.id)}
                  onOpen={() => onOpen(channel.id)}
                  onPinChange={(next) => setPinned(channel.id, next)}
                  onSearch={() =>
                    openWorkspaceSearch({
                      channelId: channel.id,
                      channelLabel: channel.label,
                    })
                  }
                  onViewDetails={() => setDetailsTarget(channel)}
                />
              ))}
          </div>
        ) : null}
      </section>
      <SidebarDirectMessages
        activeAgentId={activeAgentId}
        directMessageIds={directMessageIds}
        onOpen={onOpenDirectMessage}
        onPinChange={setAgentPinned}
        pinnedAgentIds={pinnedAgentIds}
        unreadCounts={unreadDirectMessageCounts}
      />
      <DragOverlay dropAnimation={{ duration: 160, easing: "ease-out" }}>
        {draggingItem ? (
          <div className="bg-sidebar-accent text-sidebar-foreground flex h-8 w-52 items-center gap-2 rounded-lg px-2 text-[13px] shadow-xl ring-1 ring-black/10 dark:ring-white/10">
            {draggingItem.kind === "channel" ? (
              <Hash size={14} strokeWidth={1.8} className="opacity-70" />
            ) : (
              <AgentAvatar
                label={WORKSPACE_AGENT_IDENTITIES[draggingItem.id].name}
                className="size-4"
              />
            )}
            <span className="truncate">
              {draggingItem.kind === "channel"
                ? (channels.find((channel) => channel.id === draggingItem.id)
                    ?.label ?? draggingItem.id)
                : WORKSPACE_AGENT_IDENTITIES[draggingItem.id].name}
            </span>
          </div>
        ) : null}
      </DragOverlay>
      <ChannelBrowserDialog
        channels={allChannels}
        open={channelBrowserOpen}
        onOpenChange={setChannelBrowserOpen}
        onOpenChannel={onOpen}
        onCreateChannel={onCreateChannel}
      />
      <ChannelDeleteDialog
        key={deleteTarget?.id ?? "closed"}
        channel={deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onDelete={onDeleteChannel}
      />
      <ChannelDetailsDialog
        key={detailsTarget?.id ?? "closed"}
        canManage={canManageChannels}
        channel={detailsTarget}
        onClose={() => setDetailsTarget(null)}
        onLeave={onLeaveChannel}
        onUpdate={onUpdateChannel}
      />
    </DndContext>
  );
}
