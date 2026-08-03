import { useState } from "react";
import { CalendarClock, FolderOpen, LayoutGrid, Network } from "lucide-react";
import { NavLink, useLocation, useNavigate } from "react-router";

import { cn } from "@chief/ui/lib/utils";

import type {
  SidebarPinnedItem,
  WorkspaceAgentId,
  WorkspaceChannelId,
} from "../lib/workspace-channels";
import { useAuth } from "../lib/auth/auth-context";
import {
  canDeleteChannels,
  canManageChannels,
} from "../lib/auth/organization-role";
import { useChannelReadState } from "../lib/channel-read-state-context";
import { useLocalChats, useWorkspaceChannels } from "../lib/runtime";
import {
  directMessageIdsForChats,
  isSidebarPinnedItem,
  sidebarPinnedItemKey,
  WORKSPACE_CHANNELS,
  WORKSPACE_DIRECT_MESSAGES,
  workspaceChannel,
  workspaceDirectMessage,
} from "../lib/workspace-channels";
import { SidebarChannels } from "./sidebar-channels";
import { SidebarProfileMenu } from "./sidebar-profile-menu";
import { WorkspaceSearch } from "./workspace-search";

const PRIMARY_ITEMS = [
  { to: "/", label: "Overview", icon: LayoutGrid },
  { to: "/schedule", label: "Schedule", icon: CalendarClock },
  { to: "/agents", label: "Agents", icon: Network },
  { to: "/files", label: "Files", icon: FolderOpen },
] as const;

function pinnedStorageKey(workspaceId: string | null) {
  return `chief:pinned-channels:${workspaceId ?? "local"}`;
}

function readPinnedItems(workspaceId: string | null): SidebarPinnedItem[] {
  try {
    const stored = JSON.parse(
      window.localStorage.getItem(pinnedStorageKey(workspaceId)) ?? "[]",
    ) as unknown;
    if (!Array.isArray(stored)) return [];
    return stored.flatMap((value): SidebarPinnedItem[] => {
      if (typeof value === "string") return [{ kind: "channel", id: value }];
      return isSidebarPinnedItem(value) ? [value] : [];
    });
  } catch {
    return [];
  }
}

function leftStorageKey(workspaceId: string | null) {
  return `chief:left-channels:${workspaceId ?? "local"}`;
}

function readLeftChannels(workspaceId: string | null): WorkspaceChannelId[] {
  try {
    const stored = JSON.parse(
      window.localStorage.getItem(leftStorageKey(workspaceId)) ?? "[]",
    ) as unknown;
    if (!Array.isArray(stored)) return [];
    return stored.filter((value): value is string => typeof value === "string");
  } catch {
    return [];
  }
}

function NavItem({
  to,
  label,
  icon: Icon,
}: {
  to: string;
  label: string;
  icon: typeof LayoutGrid;
}) {
  const { pathname } = useLocation();
  const active = to === "/" ? pathname === "/" : pathname.startsWith(to);
  return (
    <NavLink
      to={to}
      className={cn(
        "text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-foreground flex h-8 items-center gap-2.5 rounded-lg px-2 text-[13px] transition-colors",
        active && "bg-sidebar-accent text-sidebar-foreground font-medium",
      )}
    >
      <Icon size={15} strokeWidth={1.8} className="shrink-0" />
      <span className="truncate">{label}</span>
    </NavLink>
  );
}

export function Sidebar({
  width,
  onResizeStart,
}: {
  width: number;
  onResizeStart: (event: React.PointerEvent<HTMLDivElement>) => void;
}) {
  const { cloudOrganizationId, organizationRole } = useAuth();
  const localChats = useLocalChats(cloudOrganizationId);
  const workspaceChannels = useWorkspaceChannels();
  const { unreadChannelCounts } = useChannelReadState();
  const location = useLocation();
  const navigate = useNavigate();
  const [pinnedItems, setPinnedItems] = useState(() =>
    readPinnedItems(cloudOrganizationId),
  );
  const [leftChannelState, setLeftChannelState] = useState(() => ({
    workspaceId: cloudOrganizationId,
    ids: readLeftChannels(cloudOrganizationId),
  }));
  const leftIds =
    leftChannelState.workspaceId === cloudOrganizationId
      ? leftChannelState.ids
      : readLeftChannels(cloudOrganizationId);
  const params = new URLSearchParams(location.search);
  const requestedChannel = workspaceChannel(params.get("channel"));
  const requestedRuntimeChannel = workspaceChannels.channels.find(
    (channel) =>
      channel.visibility !== "direct" &&
      (channel.id === params.get("channel") ||
        channel.slug === params.get("channel")),
  );
  const requestedDirectMessage = workspaceDirectMessage(params.get("dm"));
  const activeChannelId = location.pathname.startsWith("/conversations")
    ? (requestedRuntimeChannel?.id ?? requestedChannel?.id ?? null)
    : null;
  const publicChannels =
    workspaceChannels.channels.length > 0
      ? workspaceChannels.channels
          .filter((channel) => channel.visibility !== "direct")
          .map((channel) => ({
            id: channel.id,
            label: channel.name,
            topic: channel.topic,
            description: channel.description,
            agentIds: channel.agentIds,
            createdAt: channel.createdAt,
          }))
      : WORKSPACE_CHANNELS.map((channel) => ({
          id: channel.id,
          label: channel.label,
          topic: "",
          description: channel.description,
          agentIds: [...channel.agentIds],
        }));
  const normalizedPinnedItems = pinnedItems.flatMap<SidebarPinnedItem>(
    (item) => {
      if (item.kind === "agent") return [item];
      if (publicChannels.some((channel) => channel.id === item.id))
        return [item];
      const legacy = WORKSPACE_CHANNELS.find(
        (channel) => channel.id === item.id,
      );
      const runtime = legacy
        ? workspaceChannels.channels.find(
            (channel) => channel.id === legacy.relayId,
          )
        : undefined;
      return runtime ? [{ kind: "channel" as const, id: runtime.id }] : [];
    },
  );
  const visiblePublicChannels = publicChannels.filter(
    (channel) => !leftIds.includes(channel.id),
  );
  const directMessageIds = directMessageIdsForChats(localChats.chats);
  const unreadDirectMessageCounts = new Map(
    WORKSPACE_DIRECT_MESSAGES.map((message) => [
      message.id,
      unreadChannelCounts.get(message.relayId) ?? 0,
    ]),
  );

  const updateLeftChannels = (next: WorkspaceChannelId[]) => {
    window.localStorage.setItem(
      leftStorageKey(cloudOrganizationId),
      JSON.stringify(next),
    );
    setLeftChannelState({ workspaceId: cloudOrganizationId, ids: next });
  };

  const openChannel = (
    channelId: WorkspaceChannelId,
    options?: { focusComposer?: boolean },
  ) => {
    if (leftIds.includes(channelId)) {
      const next = leftIds.filter((id) => id !== channelId);
      updateLeftChannels(next);
    }
    void navigate(`/conversations?channel=${channelId}`, {
      state: options?.focusComposer ? { focusComposerFor: channelId } : null,
    });
  };

  const updatePinned = (nextItems: SidebarPinnedItem[]) => {
    const keys = new Set<string>();
    const next = nextItems.filter((item) => {
      const valid =
        item.kind === "agent"
          ? directMessageIds.includes(item.id)
          : publicChannels.some((channel) => channel.id === item.id);
      const key = sidebarPinnedItemKey(item);
      if (!valid || keys.has(key)) return false;
      keys.add(key);
      return true;
    });
    window.localStorage.setItem(
      pinnedStorageKey(cloudOrganizationId),
      JSON.stringify(next),
    );
    setPinnedItems(next);
  };

  const deleteChannel = async (channelId: WorkspaceChannelId) => {
    if (activeChannelId === channelId) {
      const fallback = publicChannels.find(
        (channel) => channel.id !== channelId,
      );
      await navigate(fallback ? `/conversations?channel=${fallback.id}` : "/", {
        replace: true,
      });
    }
    await workspaceChannels.deleteChannel(channelId);
    updatePinned(
      normalizedPinnedItems.filter(
        (item) => item.kind !== "channel" || item.id !== channelId,
      ),
    );
  };

  const leaveChannel = async (channelId: WorkspaceChannelId) => {
    if (activeChannelId === channelId) {
      const fallback = visiblePublicChannels.find(
        (channel) => channel.id !== channelId,
      );
      await navigate(fallback ? `/conversations?channel=${fallback.id}` : "/", {
        replace: true,
      });
    }
    updatePinned(
      normalizedPinnedItems.filter(
        (item) => item.kind !== "channel" || item.id !== channelId,
      ),
    );
    const next = [...new Set([...leftIds, channelId])];
    updateLeftChannels(next);
  };

  return (
    <aside
      style={{ width }}
      className="bg-sidebar text-sidebar-foreground relative z-30 flex h-full shrink-0 flex-col"
    >
      <div className="shrink-0 px-3 pt-3 pb-2">
        <WorkspaceSearch />
      </div>
      <nav className="min-h-0 flex-1 [scrollbar-width:thin] [scrollbar-color:color-mix(in_srgb,var(--sidebar-muted)_22%,transparent)_transparent] overflow-y-auto px-2 pb-5">
        <div className="space-y-0.5 px-0.5 pb-1">
          {PRIMARY_ITEMS.map((item) => (
            <NavItem key={item.to} {...item} />
          ))}
        </div>
        <SidebarChannels
          canDeleteChannels={canDeleteChannels(organizationRole)}
          canManageChannels={canManageChannels(organizationRole)}
          channels={visiblePublicChannels}
          allChannels={publicChannels}
          activeChannelId={activeChannelId}
          activeAgentId={
            location.pathname.startsWith("/conversations")
              ? (requestedDirectMessage?.id ?? null)
              : null
          }
          directMessageIds={directMessageIds}
          pinnedItems={normalizedPinnedItems}
          unreadChannelCounts={unreadChannelCounts}
          unreadDirectMessageCounts={unreadDirectMessageCounts}
          onOpen={openChannel}
          onOpenDirectMessage={(agentId: WorkspaceAgentId) =>
            void navigate(`/conversations?dm=${agentId}`)
          }
          onCreateChannel={workspaceChannels.createChannel}
          onDeleteChannel={deleteChannel}
          onUpdateChannel={workspaceChannels.updateChannel}
          onLeaveChannel={leaveChannel}
          onPinnedChange={updatePinned}
        />
      </nav>
      <div className="shrink-0 px-2.5 pt-1 pb-3">
        <SidebarProfileMenu />
      </div>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        onPointerDown={onResizeStart}
        className="group absolute inset-y-0 -right-1 z-50 w-2 cursor-col-resize"
      >
        <span className="bg-foreground/30 absolute inset-y-0 left-[3px] w-px opacity-0 transition-opacity group-hover:opacity-100" />
      </div>
    </aside>
  );
}
