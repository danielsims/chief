import { useState } from "react";
import { CalendarClock, FolderOpen, LayoutGrid, Network } from "lucide-react";
import { NavLink, useLocation, useNavigate } from "react-router";

import { cn } from "@chief/ui/lib/utils";

import type { WorkspaceChannelId } from "../lib/workspace-channels";
import { useAuth } from "../lib/auth/auth-context";
import {
  WORKSPACE_CHANNELS,
  workspaceChannel,
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

function readPinnedChannels(workspaceId: string | null): WorkspaceChannelId[] {
  try {
    const stored = JSON.parse(
      window.localStorage.getItem(pinnedStorageKey(workspaceId)) ?? "[]",
    ) as unknown;
    if (!Array.isArray(stored)) return [];
    return WORKSPACE_CHANNELS.map((channel) => channel.id).filter((channelId) =>
      stored.includes(channelId),
    );
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
  const { cloudOrganizationId } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [pinnedIds, setPinnedIds] = useState(() =>
    readPinnedChannels(cloudOrganizationId),
  );
  const params = new URLSearchParams(location.search);
  const requestedChannel = workspaceChannel(params.get("channel"));
  const activeChannelId = location.pathname.startsWith("/conversations")
    ? (requestedChannel?.id ?? null)
    : null;

  const openChannel = (channelId: WorkspaceChannelId) => {
    void navigate(`/conversations?channel=${channelId}`);
  };

  const updatePinned = (nextIds: WorkspaceChannelId[]) => {
    const next = nextIds.filter(
      (id, index) =>
        WORKSPACE_CHANNELS.some((channel) => channel.id === id) &&
        nextIds.indexOf(id) === index,
    );
    window.localStorage.setItem(
      pinnedStorageKey(cloudOrganizationId),
      JSON.stringify(next),
    );
    setPinnedIds(next);
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
          activeChannelId={activeChannelId}
          pinnedIds={pinnedIds}
          onOpen={openChannel}
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
