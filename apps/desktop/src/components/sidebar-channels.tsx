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
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import {
  ArrowDownAZ,
  ChevronDown,
  Hash,
  MoreHorizontal,
  Plus,
} from "lucide-react";

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
import { ChannelDeleteDialog } from "./sidebar-channel-actions";
import { ChannelRow } from "./sidebar-channel-row";
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
  channelsNeedingUser,
  unreadChannelCounts,
  unreadDirectMessageCounts,
  onOpen,
  onOpenDirectMessage,
  onCreateChannel,
  onDeleteChannel,
  onSetChannelArchived,
  onSetChannelPolicy,
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
  channelsNeedingUser: ReadonlySet<string>;
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
  onSetChannelArchived: (
    channelId: WorkspaceChannelId,
    archived: boolean,
  ) => Promise<void>;
  onSetChannelPolicy: (
    channelId: WorkspaceChannelId,
    agentPermissions: NonNullable<SidebarChannel["agentPermissions"]>,
  ) => Promise<void>;
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
                        needsUser={channelsNeedingUser.has(item.id)}
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
                  needsUser={channelsNeedingUser.has(channel.id)}
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
        onSetArchived={onSetChannelArchived}
        onSetPolicy={onSetChannelPolicy}
        onUpdate={onUpdateChannel}
      />
    </DndContext>
  );
}
