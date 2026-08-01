import { useMemo, useState } from "react";
import {
  Archive,
  BarChart3,
  CalendarClock,
  Check,
  ChevronDown,
  CircleEllipsis,
  FileText,
  FolderOpen,
  Hash,
  LayoutGrid,
  LoaderCircle,
  Megaphone,
  Monitor,
  Moon,
  Network,
  Plus,
  Settings,
  Sun,
  Trash2,
  Users,
} from "lucide-react";
import { NavLink, useLocation, useNavigate } from "react-router";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@chief/ui/components/context-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@chief/ui/components/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@chief/ui/components/popover";
import { cn } from "@chief/ui/lib/utils";

import type { ChannelSectionId } from "../lib/channel-sections";
import type { LocalChatSummary } from "../lib/runtime";
import type { ThemePreference } from "../lib/theme";
import { useAuth } from "../lib/auth/auth-context";
import { classifyChannel } from "../lib/channel-sections";
import { createChat } from "../lib/chat-log";
import { useLocalChats, useRuntime } from "../lib/runtime";
import { useTheme } from "../lib/theme";
import { UpdateAvailable } from "./update-available";
import { WorkspaceSearch } from "./workspace-search";

const PRIMARY_ITEMS = [
  { to: "/", label: "Overview", icon: LayoutGrid },
  { to: "/artifacts", label: "Artifacts", icon: Archive },
  { to: "/schedule", label: "Schedule", icon: CalendarClock },
  { to: "/agents", label: "Agents", icon: Network },
  { to: "/files", label: "Files", icon: FolderOpen },
] as const;

const SECTIONS = [
  {
    id: "analytics",
    label: "Analytics",
    to: "/analytics",
    icon: BarChart3,
  },
  {
    id: "campaigns",
    label: "Campaigns",
    to: "/campaigns",
    icon: Megaphone,
  },
  {
    id: "prospects",
    label: "Prospects",
    to: "/prospects",
    icon: Users,
  },
] as const;

function sectionStorageKey(workspaceId: string | null) {
  return `chief:sidebar-sections:${workspaceId ?? "local"}`;
}

function readCollapsedSections(
  workspaceId: string | null,
): Set<ChannelSectionId> {
  try {
    const stored = JSON.parse(
      window.localStorage.getItem(sectionStorageKey(workspaceId)) ?? "[]",
    ) as unknown;
    return new Set(Array.isArray(stored) ? (stored as ChannelSectionId[]) : []);
  } catch {
    return new Set();
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

function SectionHeading({
  label,
  open,
  onToggle,
  onCreate,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
  onCreate: () => void;
}) {
  return (
    <div className="group/heading flex h-8 items-center pr-1 pl-1.5">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="text-sidebar-muted hover:text-sidebar-foreground flex min-w-0 flex-1 items-center gap-1.5 text-left text-[12px] font-semibold transition-colors"
      >
        <span className="relative size-3 shrink-0">
          <ChevronDown
            size={12}
            className={cn(
              "absolute inset-0 transition-transform",
              !open && "-rotate-90",
            )}
          />
        </span>
        <span className="truncate">{label}</span>
      </button>
      <button
        type="button"
        onClick={onCreate}
        aria-label={`New ${label.toLocaleLowerCase()} channel`}
        className="text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-foreground flex size-6 items-center justify-center rounded-md opacity-0 transition-opacity group-hover/heading:opacity-100 focus:opacity-100"
      >
        <Plus size={13} />
      </button>
    </div>
  );
}

function ThemeMenu() {
  const { preference, setPreference } = useTheme();
  const [open, setOpen] = useState(false);
  const choices: {
    value: ThemePreference;
    label: string;
    icon: typeof Monitor;
  }[] = [
    { value: "system", label: "System", icon: Monitor },
    { value: "light", label: "Light", icon: Sun },
    { value: "dark", label: "Dark", icon: Moon },
  ];
  const ActiveIcon =
    preference === "dark" ? Moon : preference === "light" ? Sun : Monitor;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label="Change appearance"
        className="text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-foreground flex size-8 items-center justify-center rounded-lg transition-colors"
      >
        <ActiveIcon size={14} />
      </PopoverTrigger>
      <PopoverContent side="right" align="end" className="w-44">
        {choices.map(({ value, label, icon: Icon }) => (
          <button
            key={value}
            type="button"
            onClick={() => {
              setPreference(value);
              setOpen(false);
            }}
            className="hover:bg-accent flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs"
          >
            <Icon size={14} className="text-muted-foreground" />
            <span className="flex-1">{label}</span>
            {preference === value ? <Check size={13} /> : null}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

function ChannelRow({
  channel,
  active,
  onOpen,
  onDelete,
}: {
  channel: LocalChatSummary;
  active: boolean;
  onOpen: () => void;
  onDelete: () => void;
}) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <button
          type="button"
          onClick={onOpen}
          aria-current={active ? "page" : undefined}
          className={cn(
            "group/channel text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-foreground flex h-8 w-full min-w-0 items-center gap-2 rounded-lg px-2 text-left text-[13px] transition-colors",
            active && "bg-sidebar-accent text-sidebar-foreground font-medium",
          )}
        >
          {channel.running ? (
            <LoaderCircle size={14} className="shrink-0 animate-spin" />
          ) : (
            <Hash size={14} strokeWidth={1.8} className="shrink-0 opacity-70" />
          )}
          <span className="min-w-0 flex-1 truncate">{channel.title}</span>
          <CircleEllipsis
            size={14}
            className="shrink-0 opacity-0 transition-opacity group-hover/channel:opacity-60 group-focus/channel:opacity-60"
          />
        </button>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        <ContextMenuLabel className="truncate">
          {channel.title}
        </ContextMenuLabel>
        <ContextMenuItem onSelect={onOpen}>
          <Hash size={14} /> Open channel
        </ContextMenuItem>
        <ContextMenuItem
          onSelect={() =>
            void navigator.clipboard.writeText(
              `${window.location.origin}/conversations?chat=${channel.id}`,
            )
          }
        >
          <FileText size={14} /> Copy channel link
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          onSelect={onDelete}
          className="text-destructive data-[highlighted]:bg-destructive/10 data-[highlighted]:text-destructive"
        >
          <Trash2 size={14} /> Delete channel
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

export function Sidebar({
  width,
  onResizeStart,
}: {
  width: number;
  onResizeStart: (event: React.PointerEvent<HTMLDivElement>) => void;
}) {
  const { cloudOrganizationId, user } = useAuth();
  const { status } = useRuntime();
  const chats = useLocalChats(cloudOrganizationId);
  const location = useLocation();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(() =>
    readCollapsedSections(cloudOrganizationId),
  );
  const [deleteTarget, setDeleteTarget] = useState<LocalChatSummary | null>(
    null,
  );
  const activeChatId = new URLSearchParams(location.search).get("chat");
  const groupedChats = useMemo(() => {
    const groups = new Map<ChannelSectionId, LocalChatSummary[]>([
      ["analytics", []],
      ["campaigns", []],
      ["prospects", []],
      ["general", []],
    ]);
    chats.chats.forEach((chat) =>
      groups.get(classifyChannel(chat))?.push(chat),
    );
    return groups;
  }, [chats.chats]);

  const openNewChannel = () => {
    const chat = createChat();
    void navigate(`/conversations?chat=${chat.id}`);
  };
  const toggleSection = (section: ChannelSectionId) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      window.localStorage.setItem(
        sectionStorageKey(cloudOrganizationId),
        JSON.stringify([...next]),
      );
      return next;
    });
  };
  const renderChannels = (section: ChannelSectionId) =>
    groupedChats
      .get(section)
      ?.map((channel) => (
        <ChannelRow
          key={channel.id}
          channel={channel}
          active={
            location.pathname.startsWith("/conversations") &&
            activeChatId === channel.id
          }
          onOpen={() => navigate(`/conversations?chat=${channel.id}`)}
          onDelete={() => setDeleteTarget(channel)}
        />
      ));

  return (
    <>
      <aside
        style={{ width }}
        className="bg-sidebar text-sidebar-foreground relative z-30 flex h-full shrink-0 flex-col"
      >
        <div className="shrink-0 px-3 pt-3 pb-2">
          <WorkspaceSearch chats={chats.chats} />
        </div>
        <nav className="min-h-0 flex-1 [scrollbar-width:thin] [scrollbar-color:color-mix(in_srgb,var(--sidebar-muted)_22%,transparent)_transparent] overflow-y-auto px-2 pb-5">
          <div className="space-y-0.5 px-0.5 pb-3">
            {PRIMARY_ITEMS.map((item) => (
              <NavItem key={item.to} {...item} />
            ))}
          </div>
          {SECTIONS.map((section) => (
            <div key={section.id} className="mt-3">
              <SectionHeading
                label={section.label}
                open={!collapsed.has(section.id)}
                onToggle={() => toggleSection(section.id)}
                onCreate={openNewChannel}
              />
              {!collapsed.has(section.id) ? (
                <div className="space-y-0.5">
                  <NavItem
                    to={section.to}
                    label={`${section.label} overview`}
                    icon={section.icon}
                  />
                  {renderChannels(section.id)}
                </div>
              ) : null}
            </div>
          ))}
          <div className="mt-3">
            <SectionHeading
              label="General"
              open={!collapsed.has("general")}
              onToggle={() => toggleSection("general")}
              onCreate={openNewChannel}
            />
            {!collapsed.has("general") ? (
              <div className="space-y-0.5">
                {renderChannels("general")}
                {!chats.loading && chats.chats.length === 0 ? (
                  <button
                    type="button"
                    onClick={openNewChannel}
                    className="text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-foreground flex h-8 w-full items-center gap-2 rounded-lg px-2 text-left text-xs"
                  >
                    <Plus size={13} /> Start a channel
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        </nav>
        <div className="border-sidebar-border/70 shrink-0 border-t p-2.5">
          <div className="group/profile hover:bg-sidebar-accent/70 flex min-w-0 items-center gap-2.5 rounded-xl px-2 py-2">
            <span className="bg-sidebar-accent flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-xl text-xs font-semibold">
              {user?.image ? (
                <img
                  src={user.image}
                  alt=""
                  className="size-full object-cover"
                />
              ) : (
                (user?.name.trim().charAt(0) ?? "C").toLocaleUpperCase()
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] leading-4 font-semibold">
                {user?.name ?? "Chief workspace"}
              </span>
              <span className="text-sidebar-muted flex items-center gap-1.5 truncate text-[10px]">
                <span
                  className={cn(
                    "size-1.5 shrink-0 rounded-full",
                    status === "connected" && "bg-emerald-500",
                    status === "connecting" && "animate-pulse bg-amber-400",
                    status === "disconnected" && "bg-destructive",
                  )}
                />
                Runtime {status}
              </span>
            </span>
            <UpdateAvailable />
            <ThemeMenu />
            <NavLink
              to="/settings"
              aria-label="Settings"
              className="text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-foreground flex size-8 shrink-0 items-center justify-center rounded-lg"
            >
              <Settings size={14} />
            </NavLink>
          </div>
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
      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <DialogContent className="rounded-2xl sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete this channel?</DialogTitle>
            <DialogDescription>
              “{deleteTarget?.title}” and its local conversation history will be
              removed from this workspace.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button
              type="button"
              onClick={() => setDeleteTarget(null)}
              className="hover:bg-accent rounded-lg border px-3 py-2 text-xs"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                if (deleteTarget) chats.remove(deleteTarget.id);
                if (deleteTarget?.id === activeChatId)
                  void navigate("/conversations");
                setDeleteTarget(null);
              }}
              className="bg-destructive text-destructive-foreground rounded-lg px-3 py-2 text-xs"
            >
              Delete channel
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
