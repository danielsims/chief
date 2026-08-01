/* eslint-disable react-hooks/refs -- Dnd Kit exposes stable ref callbacks and reactive drag state through hook return objects. */
import type { CollisionDetection, DragEndEvent } from "@dnd-kit/core";
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
import { ChevronDown, Hash, Pin, PinOff } from "lucide-react";

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
import {
  placePinnedChannel,
  WORKSPACE_CHANNELS,
} from "../lib/workspace-channels";

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
  channelId: WorkspaceChannelId;
  active: boolean;
  pinned: boolean;
  dragKind: "source" | "sortable";
  onOpen: () => void;
  onPinChange: (pinned: boolean) => void;
}

function ChannelRow({
  channelId,
  active,
  pinned,
  dragKind,
  onOpen,
  onPinChange,
}: ChannelRowProps) {
  const channel = WORKSPACE_CHANNELS.find((item) => item.id === channelId);
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
  if (!channel) return null;

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
        "relative touch-none select-none",
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
              "group/channel text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-foreground flex h-8 w-full min-w-0 cursor-grab touch-none items-center gap-2 rounded-lg px-2 text-left text-[13px] transition-colors select-none active:cursor-grabbing",
              active && "bg-sidebar-accent text-sidebar-foreground font-medium",
              drag.isDragging && "cursor-grabbing",
            )}
          >
            <Hash size={14} strokeWidth={1.8} className="shrink-0 opacity-70" />
            <span className="min-w-0 flex-1 truncate">{channel.label}</span>
          </button>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-52 rounded-xl p-1.5 shadow-xl">
          <ContextMenuLabel className="px-2 py-1.5 text-xs font-medium normal-case">
            #{channel.label}
          </ContextMenuLabel>
          <ContextMenuItem className="rounded-lg" onSelect={onOpen}>
            <Hash size={14} /> Open channel
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            className="rounded-lg"
            onSelect={() => onPinChange(!pinned)}
          >
            {pinned ? <PinOff size={14} /> : <Pin size={14} />}
            {pinned ? "Remove from pinned" : "Pin channel"}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    </div>
  );
}

function GroupLabel({
  children,
  collapsed,
  onToggle,
}: {
  children: string;
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={!collapsed}
      className="text-sidebar-muted hover:text-sidebar-foreground group flex h-8 w-full items-center gap-1.5 rounded-lg px-2 text-left text-xs font-semibold transition-colors"
    >
      <span>{children}</span>
      <ChevronDown
        size={13}
        strokeWidth={1.8}
        className={cn(
          "opacity-0 transition-[opacity,transform] group-hover:opacity-100 group-focus-visible:opacity-100",
          collapsed && "-rotate-90",
        )}
      />
    </button>
  );
}

export function SidebarChannels({
  activeChannelId,
  pinnedIds,
  onOpen,
  onPinnedChange,
}: {
  activeChannelId: WorkspaceChannelId | null;
  pinnedIds: WorkspaceChannelId[];
  onOpen: (channelId: WorkspaceChannelId) => void;
  onPinnedChange: (pinnedIds: WorkspaceChannelId[]) => void;
}) {
  const [pinnedCollapsed, setPinnedCollapsed] = useState(false);
  const [channelsCollapsed, setChannelsCollapsed] = useState(false);
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
                {pinnedIds.map((channelId) => (
                  <ChannelRow
                    key={channelId}
                    channelId={channelId}
                    active={activeChannelId === channelId}
                    pinned
                    dragKind="sortable"
                    onOpen={() => onOpen(channelId)}
                    onPinChange={(next) => setPinned(channelId, next)}
                  />
                ))}
              </div>
            </SortableContext>
          </div>
        ) : null}
      </section>

      <section className="mt-3 px-0.5">
        <GroupLabel
          collapsed={channelsCollapsed}
          onToggle={() => setChannelsCollapsed((current) => !current)}
        >
          Channels
        </GroupLabel>
        {!channelsCollapsed ? (
          <div className="space-y-0.5">
            {WORKSPACE_CHANNELS.filter(
              (channel) => !pinned.has(channel.id),
            ).map((channel) => (
              <ChannelRow
                key={channel.id}
                channelId={channel.id}
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
      <DragOverlay dropAnimation={{ duration: 160, easing: "ease-out" }}>
        {draggingId ? (
          <div className="bg-sidebar-accent text-sidebar-foreground flex h-8 w-52 items-center gap-2 rounded-lg px-2 text-[13px] shadow-xl ring-1 ring-black/10 dark:ring-white/10">
            <Hash size={14} strokeWidth={1.8} className="opacity-70" />
            <span className="truncate">
              {WORKSPACE_CHANNELS.find((channel) => channel.id === draggingId)
                ?.label ?? draggingId}
            </span>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
