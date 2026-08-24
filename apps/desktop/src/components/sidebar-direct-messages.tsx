import { useState } from "react";
import { useDraggable } from "@dnd-kit/core";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChevronDown, MoreHorizontal, Pin, PinOff } from "lucide-react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@chief/ui/components/popover";
import { cn } from "@chief/ui/lib/utils";

import type {
  SidebarPinnedItem,
  WorkspaceAgentId,
} from "../lib/workspace-channels";
import {
  sidebarPinnedItemKey,
  WORKSPACE_AGENT_IDENTITIES,
  WORKSPACE_DIRECT_MESSAGES,
} from "../lib/workspace-channels";
import { AgentAvatar } from "./agent-avatar";
import { AttentionPill } from "./attention-pill";

export function DirectMessageRow({
  active,
  agentId,
  compactAttention,
  dragKind,
  needsUser,
  onOpen,
  onPinChange,
  pinned,
  unreadCount,
}: {
  active: boolean;
  agentId: WorkspaceAgentId;
  compactAttention: boolean;
  dragKind: "source" | "sortable";
  needsUser: boolean;
  onOpen: () => void;
  onPinChange: (pinned: boolean) => void;
  pinned: boolean;
  unreadCount: number;
}) {
  const item = { kind: "agent", id: agentId } satisfies SidebarPinnedItem;
  const identity = WORKSPACE_AGENT_IDENTITIES[agentId];
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
        "group/direct relative touch-none select-none",
        sortableIsOver &&
          "before:bg-sidebar-foreground before:absolute before:-top-px before:right-2 before:left-2 before:z-10 before:h-px",
        isDragging && "z-20 opacity-45",
      )}
    >
      <button
        ref={setActivatorNodeRef}
        {...dragAttributes}
        {...dragListeners}
        type="button"
        aria-current={active ? "page" : undefined}
        onClick={onOpen}
        className={cn(
          "text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-foreground flex h-8 w-full min-w-0 cursor-grab touch-none items-center gap-2 rounded-lg px-2 text-left text-[13px] transition-[padding,color,background-color] select-none active:cursor-grabbing",
          needsUser
            ? menuOpen
              ? "pr-9"
              : "pr-2 group-focus-within/direct:pr-9 group-hover/direct:pr-9"
            : "pr-9",
          active && "bg-sidebar-accent text-sidebar-foreground font-medium",
          !active && unreadCount > 0 && "text-sidebar-foreground font-semibold",
          isDragging && "cursor-grabbing",
        )}
      >
        <AgentAvatar
          label={identity.name}
          className="bg-sidebar-foreground text-sidebar size-4 dark:bg-white dark:text-black"
        />
        <span className="min-w-0 flex-1 truncate">{identity.name}</span>
        {needsUser || unreadCount > 0 ? (
          <span className="ml-auto flex shrink-0 items-center gap-1.5">
            {needsUser ? <AttentionPill compact={compactAttention} /> : null}
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
      {pinned ? (
        <button
          type="button"
          aria-label={`Unpin ${identity.name}`}
          title="Remove from pinned"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            onPinChange(false);
          }}
          className="text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-foreground pointer-events-none absolute top-1 right-1 flex size-6 items-center justify-center rounded-md opacity-0 transition-[opacity,color,background-color] group-hover/direct:pointer-events-auto group-hover/direct:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100 focus-visible:outline-none"
        >
          <PinOff size={13} strokeWidth={1.8} />
        </button>
      ) : (
        <Popover open={menuOpen} onOpenChange={setMenuOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={`More options for ${identity.name}`}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
              className="text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-foreground pointer-events-none absolute top-1 right-1 flex size-6 items-center justify-center rounded-md opacity-0 transition-[opacity,color,background-color] group-hover/direct:pointer-events-auto group-hover/direct:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100 focus-visible:outline-none data-[state=open]:pointer-events-auto data-[state=open]:opacity-100"
            >
              <MoreHorizontal size={14} strokeWidth={1.8} />
            </button>
          </PopoverTrigger>
          <PopoverContent side="right" align="start" className="w-48 p-1">
            <button
              type="button"
              onClick={() => onPinChange(true)}
              className="hover:bg-accent flex h-9 w-full items-center gap-2 rounded-lg px-2.5 text-left text-[13px]"
            >
              <Pin size={14} strokeWidth={1.7} />
              Pin conversation
            </button>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}

export function SidebarDirectMessages({
  activeAgentId,
  attentionTargets,
  compactAttention,
  directMessageIds,
  onOpen,
  onPinChange,
  pinnedAgentIds,
  unreadCounts,
}: {
  activeAgentId: WorkspaceAgentId | null;
  attentionTargets: ReadonlyMap<
    WorkspaceAgentId,
    { threadRootId?: string; messageId: string }
  >;
  compactAttention: boolean;
  directMessageIds: WorkspaceAgentId[];
  onOpen: (
    agentId: WorkspaceAgentId,
    target?: { threadRootId?: string; messageId: string },
  ) => void;
  onPinChange: (agentId: WorkspaceAgentId, pinned: boolean) => void;
  pinnedAgentIds: WorkspaceAgentId[];
  unreadCounts: ReadonlyMap<WorkspaceAgentId, number>;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const visibleIds = directMessageIds.filter(
    (agentId) => !pinnedAgentIds.includes(agentId),
  );
  if (visibleIds.length === 0) return null;

  return (
    <section className="mt-3 px-0.5">
      <button
        type="button"
        onClick={() => setCollapsed((current) => !current)}
        aria-expanded={!collapsed}
        className="text-sidebar-muted hover:text-sidebar-foreground group flex h-8 w-full items-center gap-1.5 px-2 text-left text-xs font-semibold transition-colors"
      >
        <span>DMs</span>
        <ChevronDown
          size={13}
          className={cn(
            "opacity-0 transition-[opacity,transform] group-hover:opacity-100 group-focus-visible:opacity-100",
            collapsed && "-rotate-90",
          )}
        />
      </button>
      {!collapsed ? (
        <div className="space-y-0.5">
          {WORKSPACE_DIRECT_MESSAGES.filter((message) =>
            visibleIds.includes(message.id),
          ).map((message) => (
            <DirectMessageRow
              key={message.id}
              active={activeAgentId === message.id}
              agentId={message.id}
              compactAttention={compactAttention}
              dragKind="source"
              needsUser={attentionTargets.has(message.id)}
              onOpen={() =>
                onOpen(message.id, attentionTargets.get(message.id))
              }
              onPinChange={(pinned) => onPinChange(message.id, pinned)}
              pinned={false}
              unreadCount={unreadCounts.get(message.id) ?? 0}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}
