import { useEffect, useMemo, useState } from "react";
import { useDraggable } from "@dnd-kit/core";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChevronDown, MoreHorizontal, Pin, PinOff, Plus } from "lucide-react";

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
import { useAuth } from "../lib/auth/auth-context";
import {
  readSidebarDirectMessagesCache,
  writeSidebarDirectMessagesCache,
} from "../lib/sidebar-direct-messages-cache";
import {
  sidebarPinnedItemKey,
  workspaceAgentIdentity,
} from "../lib/workspace-channels";
import { useWorkspaceChannels } from "../lib/workspace-channels-context";
import { AgentAvatar } from "./agent-avatar";
import { AttentionPill } from "./attention-pill";
import { useWorkspaceUsers } from "./chat/mention-people-context";
import { NewDirectMessageDialog } from "./new-direct-message-dialog";
import { UserAvatar } from "./user-avatar";
import { OPEN_NEW_MESSAGE_EVENT } from "./workspace-search";

export function DirectMessageRow({
  active,
  agentId,
  compactAttention,
  dragKind,
  needsUser,
  name,
  onOpen,
  onPinChange,
  pinned,
  unreadCount,
  expanded,
  onExpand,
}: {
  expanded?: boolean;
  onExpand?: () => void;
  active: boolean;
  agentId: WorkspaceAgentId;
  compactAttention: boolean;
  dragKind: "source" | "sortable";
  needsUser: boolean;
  name?: string;
  onOpen: () => void;
  onPinChange: (pinned: boolean) => void;
  pinned: boolean;
  unreadCount: number;
}) {
  const item = { kind: "agent", id: agentId } satisfies SidebarPinnedItem;
  const identity = workspaceAgentIdentity(
    agentId,
    name ? [{ id: agentId, name, role: "Agent" }] : [],
  );
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
          agentId={agentId}
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
      {onExpand ? (
        <button
          type="button"
          aria-label={`${expanded ? "Hide" : "Show"} ${identity.name} agents`}
          aria-expanded={expanded}
          onClick={onExpand}
          className="text-sidebar-muted hover:text-sidebar-foreground absolute top-1 right-8 flex size-6 items-center justify-center rounded-md"
        >
          <ChevronDown size={14} className={cn(!expanded && "-rotate-90")} />
        </button>
      ) : null}
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
  activeChannelId,
  onOpenChannel,
  attentionTargets,
  compactAttention,
  directMessageIds,
  onOpen,
  onPinChange,
  pinnedAgentIds,
  unreadCounts,
  unreadChannelCounts,
  lastMessageAtByAgent,
  lastMessageAtByChannel,
  agents,
}: {
  activeAgentId: WorkspaceAgentId | null;
  activeChannelId: string | null;
  onOpenChannel: (channelId: string) => void;
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
  /** Person-to-person DMs are channels, so their unread counts key by channel. */
  unreadChannelCounts: ReadonlyMap<string, number>;
  /** Latest message time (ms) in each agent's DM. */
  lastMessageAtByAgent: ReadonlyMap<WorkspaceAgentId, number>;
  lastMessageAtByChannel: ReadonlyMap<string, number>;
  agents: readonly {
    id: string;
    name: string;
    role: string;
    canMessage?: boolean;
    subagents?: readonly {
      id: string;
      name: string;
      role: string;
      canMessage?: boolean;
    }[];
  }[];
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [newMessageOpen, setNewMessageOpen] = useState(false);
  useEffect(() => {
    const open = () => setNewMessageOpen(true);
    window.addEventListener(OPEN_NEW_MESSAGE_EVENT, open);
    return () => window.removeEventListener(OPEN_NEW_MESSAGE_EVENT, open);
  }, []);
  const { user, cloudOrganizationId } = useAuth();
  const workspaceUsers = useWorkspaceUsers();
  const { channels } = useWorkspaceChannels();
  // Painted until channels, members and history arrive, so launch shows the
  // same rows in the same order instead of filling in over a few seconds.
  const cached = useMemo(
    () => readSidebarDirectMessagesCache(cloudOrganizationId),
    [cloudOrganizationId],
  );
  // Every workspace has channels, so an empty list means it hasn't loaded.
  const channelsLoaded = channels.length > 0;
  const peopleDirects = channelsLoaded
    ? channels.flatMap((channel) => {
        const userId = channel.directUserId;
        if (!userId || userId === user?.id) return [];
        const person = workspaceUsers.get(userId);
        const previous = cached.people.find(
          (entry) => entry.channelId === channel.id,
        );
        return [
          {
            channelId: channel.id,
            name: person?.name ?? previous?.name ?? channel.name,
            image: person?.image ?? previous?.image,
          },
        ];
      })
    : cached.people;
  const [collapsedTeams, setCollapsedTeams] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const allAgents = agents.flatMap((agent) => [
    agent,
    ...(agent.subagents ?? []).map((child) => ({
      ...child,
      subagents: undefined,
    })),
  ]);
  const visibleIds = directMessageIds.filter(
    (agentId) =>
      !pinnedAgentIds.includes(agentId) &&
      (agents.some((agent) => agent.id === agentId) ||
        agents.some(
          (agent) =>
            pinnedAgentIds.includes(agent.id) &&
            agent.subagents?.some((child) => child.id === agentId),
        )),
  );
  const renderPerson = (direct: (typeof peopleDirects)[number]) => {
    const unread = unreadChannelCounts.get(direct.channelId) ?? 0;
    return (
      <button
        key={direct.channelId}
        type="button"
        aria-current={activeChannelId === direct.channelId ? "page" : undefined}
        onClick={() => onOpenChannel(direct.channelId)}
        className={cn(
          "text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-foreground flex h-8 w-full min-w-0 items-center gap-2 rounded-lg px-2 text-left text-[13px] transition-colors",
          activeChannelId === direct.channelId &&
            "bg-sidebar-accent text-sidebar-foreground font-medium",
          activeChannelId !== direct.channelId &&
            unread > 0 &&
            "text-sidebar-foreground font-semibold",
        )}
      >
        <UserAvatar
          name={direct.name}
          image={direct.image}
          className="size-4 text-[8px]"
        />
        <span className="min-w-0 flex-1 truncate">{direct.name}</span>
        {unread > 0 ? (
          <span
            aria-label={`${unread} unread ${unread === 1 ? "message" : "messages"}`}
            className="bg-sidebar-foreground/10 text-sidebar-foreground ml-auto min-w-5 shrink-0 rounded-full px-1.5 text-center text-[10px] leading-5 font-semibold tabular-nums"
          >
            {unread > 99 ? "99+" : unread}
          </span>
        ) : null}
      </button>
    );
  };
  const renderAgent = (agentId: WorkspaceAgentId) => {
    const agent = allAgents.find((candidate) => candidate.id === agentId);
    const children = (agent?.subagents ?? []).filter(
      (child) =>
        child.canMessage !== false && !pinnedAgentIds.includes(child.id),
    );
    const expanded = !collapsedTeams.has(agentId);
    const row = (id: string, name?: string) => (
      <DirectMessageRow
        key={id}
        active={activeAgentId === id}
        agentId={id}
        name={name}
        compactAttention={compactAttention}
        dragKind="source"
        needsUser={attentionTargets.has(id)}
        onOpen={() => onOpen(id, attentionTargets.get(id))}
        onPinChange={(pinned) => onPinChange(id, pinned)}
        pinned={false}
        unreadCount={unreadCounts.get(id) ?? 0}
        expanded={expanded}
        onExpand={
          id === agentId && children.length > 0
            ? () =>
                setCollapsedTeams((current) => {
                  const next = new Set(current);
                  if (next.has(id)) next.delete(id);
                  else next.add(id);
                  return next;
                })
            : undefined
        }
      />
    );
    return (
      <div key={agentId}>
        {row(agentId, agent?.name)}
        {expanded && children.length > 0 ? (
          <div className="before:bg-border relative mt-0.5 space-y-0.5 pl-[17px] before:absolute before:inset-y-0 before:left-4 before:w-px before:-translate-x-1/2">
            {children.map((child) => row(child.id, child.name))}
          </div>
        ) : null}
      </div>
    );
  };
  const messageableIds = visibleIds.filter(
    (id) => allAgents.find((agent) => agent.id === id)?.canMessage !== false,
  );
  // People and agents together, most recent message first; DMs without
  // messages keep their roster order below.
  const recentFirst = [
    ...peopleDirects.map((direct) => ({
      kind: "person" as const,
      key: `channel:${direct.channelId}`,
      direct,
      live: lastMessageAtByChannel.get(direct.channelId) ?? 0,
    })),
    ...messageableIds.map((agentId) => ({
      kind: "agent" as const,
      key: `agent:${agentId}`,
      agentId,
      live: lastMessageAtByAgent.get(agentId) ?? 0,
    })),
  ]
    .map((entry) => ({
      ...entry,
      at: Math.max(entry.live, cached.lastMessageAt[entry.key] ?? 0),
    }))
    .map((entry, index) => ({ ...entry, index }))
    .sort((a, b) => b.at - a.at || a.index - b.index);
  const nextCache = JSON.stringify({
    people: peopleDirects,
    lastMessageAt: Object.fromEntries(
      recentFirst
        .filter((entry) => entry.at > 0)
        .map((entry) => [entry.key, entry.at]),
    ),
  });
  useEffect(() => {
    if (!channelsLoaded) return;
    writeSidebarDirectMessagesCache(cloudOrganizationId, nextCache);
  }, [channelsLoaded, cloudOrganizationId, nextCache]);
  return (
    <section className="mt-3 px-0.5">
      <div className="group/heading flex h-8 items-center px-2">
        <button
          type="button"
          onClick={() => setCollapsed((current) => !current)}
          aria-expanded={!collapsed}
          className="text-sidebar-muted hover:text-sidebar-foreground flex min-w-0 flex-1 items-center gap-1.5 text-left text-xs font-semibold transition-colors"
        >
          <span className="truncate">DMs</span>
          <ChevronDown
            size={13}
            strokeWidth={1.8}
            className={cn(
              "opacity-0 transition-[opacity,transform] group-hover/heading:opacity-100 group-focus-visible/heading:opacity-100",
              collapsed && "-rotate-90",
            )}
          />
        </button>
        <div className="flex items-center opacity-0 transition-opacity group-hover/heading:opacity-100 focus-within:opacity-100">
          <button
            type="button"
            aria-label="New message"
            title="New message"
            onClick={() => setNewMessageOpen(true)}
            className="text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-foreground flex size-6 items-center justify-center rounded-md"
          >
            <Plus size={13} />
          </button>
        </div>
      </div>
      <NewDirectMessageDialog
        open={newMessageOpen}
        onOpenChange={setNewMessageOpen}
      />
      {!collapsed ? (
        <div className="space-y-0.5">
          {recentFirst.map((entry) =>
            entry.kind === "person"
              ? renderPerson(entry.direct)
              : renderAgent(entry.agentId),
          )}
        </div>
      ) : null}
    </section>
  );
}
