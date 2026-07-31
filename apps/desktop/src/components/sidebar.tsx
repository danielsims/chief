import { useState } from "react";
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
  Search,
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

import type { LocalChatSummary } from "../lib/runtime";
import type { ThemePreference } from "../lib/theme";
import { useAuth } from "../lib/auth/auth-context";
import { createChat } from "../lib/chat-log";
import { useLocalChats, useRuntime } from "../lib/runtime";
import { useTheme } from "../lib/theme";
import { ChiefMark } from "./chief-mark";
import { UpdateAvailable } from "./update-available";
import { WorkspaceSwitcher } from "./workspace-switcher";

const HOME_ITEMS = [
  { to: "/", label: "Overview", icon: LayoutGrid },
  { to: "/files", label: "Files", icon: FolderOpen },
];

const WORK_ITEMS = [
  { to: "/artifacts", label: "Artifacts", icon: Archive },
  { to: "/schedule", label: "Schedule", icon: CalendarClock },
  { to: "/agents", label: "Agents", icon: Network },
];

const LIBRARY_ITEMS = [
  { to: "/analytics", label: "Analytics", icon: BarChart3 },
  { to: "/campaigns", label: "Campaigns", icon: Megaphone },
  { to: "/prospects", label: "Prospects", icon: Users },
];

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
        "text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-foreground flex h-8 items-center gap-2.5 px-2 text-[13px] transition-colors",
        active && "bg-sidebar-accent text-sidebar-foreground font-medium",
      )}
    >
      <Icon size={15} strokeWidth={1.8} className="shrink-0" />
      <span className="truncate">{label}</span>
    </NavLink>
  );
}

function GroupHeading({
  label,
  open,
  onToggle,
  action,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
  action?: React.ReactNode;
}) {
  return (
    <div className="group/heading flex h-7 items-center px-1">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="text-sidebar-muted hover:text-sidebar-foreground flex min-w-0 flex-1 items-center gap-1 text-[10px] font-semibold tracking-[0.075em] uppercase"
      >
        <ChevronDown
          size={11}
          className={cn("transition-transform", !open && "-rotate-90")}
        />
        <span className="truncate">{label}</span>
      </button>
      {action}
    </div>
  );
}

function ThemeMenu() {
  const { preference, setPreference } = useTheme();
  const choices: {
    value: ThemePreference;
    label: string;
    icon: typeof Monitor;
  }[] = [
    { value: "system", label: "System", icon: Monitor },
    { value: "light", label: "Light", icon: Sun },
    { value: "dark", label: "Dark", icon: Moon },
  ];
  return (
    <Popover>
      <PopoverTrigger
        aria-label="Change appearance"
        className="text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-foreground flex size-8 items-center justify-center transition-colors"
      >
        {preference === "dark" ? (
          <Moon size={14} />
        ) : preference === "light" ? (
          <Sun size={14} />
        ) : (
          <Monitor size={14} />
        )}
      </PopoverTrigger>
      <PopoverContent side="right" align="end" className="w-40">
        {choices.map(({ value, label, icon: Icon }) => (
          <button
            key={value}
            type="button"
            onClick={() => setPreference(value)}
            className="hover:bg-accent flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs"
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
          className={cn(
            "text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-foreground group/channel flex h-8 w-full min-w-0 items-center gap-2 px-2 text-left text-[13px] transition-colors",
            active && "bg-sidebar-accent text-sidebar-foreground font-medium",
          )}
        >
          {channel.running ? (
            <LoaderCircle size={14} className="shrink-0 animate-spin" />
          ) : (
            <Hash size={14} strokeWidth={1.8} className="shrink-0" />
          )}
          <span className="min-w-0 flex-1 truncate">{channel.title}</span>
          <CircleEllipsis
            size={13}
            className="shrink-0 opacity-0 group-hover/channel:opacity-70"
          />
        </button>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuLabel>{channel.title}</ContextMenuLabel>
        <ContextMenuItem onSelect={onOpen}>
          <Hash size={13} /> Open channel
        </ContextMenuItem>
        <ContextMenuItem
          onSelect={() =>
            void navigator.clipboard.writeText(
              `${window.location.origin}/conversations?chat=${channel.id}`,
            )
          }
        >
          <FileText size={13} /> Copy channel link
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          onSelect={onDelete}
          className="text-destructive data-[highlighted]:bg-destructive/10 data-[highlighted]:text-destructive"
        >
          <Trash2 size={13} /> Delete channel
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
  const { cloudOrganizationId } = useAuth();
  const { status } = useRuntime();
  const chats = useLocalChats(cloudOrganizationId);
  const location = useLocation();
  const navigate = useNavigate();
  const [channelsOpen, setChannelsOpen] = useState(true);
  const [workOpen, setWorkOpen] = useState(true);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<LocalChatSummary | null>(
    null,
  );
  const activeChatId = new URLSearchParams(location.search).get("chat");

  const openNewChannel = () => {
    const chat = createChat();
    void navigate(`/conversations?chat=${chat.id}`);
  };

  return (
    <>
      <aside
        style={{ width }}
        className="bg-sidebar text-sidebar-foreground border-sidebar-border fixed inset-y-0 left-0 z-40 flex flex-col border-r"
      >
        <div className="relative h-[66px] shrink-0">
          <div data-tauri-drag-region className="absolute inset-0" />
          <div className="pointer-events-none absolute right-3 bottom-2.5 left-3 flex items-center gap-2">
            <ChiefMark className="h-[18px] w-[18px]" />
            <span className="font-serif text-[15px] leading-none font-semibold tracking-[-0.025em]">
              Chief
            </span>
          </div>
        </div>

        <div className="px-2 pb-2">
          <button
            type="button"
            onClick={() => navigate("/conversations")}
            className="text-sidebar-muted border-sidebar-border hover:bg-sidebar-accent hover:text-sidebar-foreground flex h-8 w-full items-center gap-2 border px-2 text-left text-xs transition-colors"
          >
            <Search size={13} />
            <span className="flex-1">Search Chief</span>
            <span className="font-mono text-[9px] opacity-60">⌘ K</span>
          </button>
        </div>

        <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
          <div className="space-y-0.5">
            {HOME_ITEMS.map((item) => (
              <NavItem key={item.to} {...item} />
            ))}
          </div>

          <div className="mt-5">
            <GroupHeading
              label="Channels"
              open={channelsOpen}
              onToggle={() => setChannelsOpen((value) => !value)}
              action={
                <button
                  type="button"
                  onClick={openNewChannel}
                  aria-label="New channel"
                  className="text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-foreground flex size-6 items-center justify-center opacity-70 hover:opacity-100"
                >
                  <Plus size={13} />
                </button>
              }
            />
            {channelsOpen ? (
              <div className="space-y-0.5">
                {chats.chats.map((channel) => (
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
                ))}
                {!chats.loading && chats.chats.length === 0 ? (
                  <button
                    type="button"
                    onClick={openNewChannel}
                    className="text-sidebar-muted hover:text-sidebar-foreground flex h-8 w-full items-center gap-2 px-2 text-left text-xs"
                  >
                    <Plus size={13} /> Start a channel
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="mt-4">
            <GroupHeading
              label="Work"
              open={workOpen}
              onToggle={() => setWorkOpen((value) => !value)}
            />
            {workOpen ? (
              <div className="space-y-0.5">
                {WORK_ITEMS.map((item) => (
                  <NavItem key={item.to} {...item} />
                ))}
              </div>
            ) : null}
          </div>

          <div className="mt-4">
            <GroupHeading
              label="Library"
              open={libraryOpen}
              onToggle={() => setLibraryOpen((value) => !value)}
            />
            {libraryOpen ? (
              <div className="space-y-0.5">
                {LIBRARY_ITEMS.map((item) => (
                  <NavItem key={item.to} {...item} />
                ))}
              </div>
            ) : null}
          </div>
        </nav>

        <div className="border-sidebar-border border-t p-2">
          <div className="flex items-center gap-1">
            <WorkspaceSwitcher />
            <span className="text-sidebar-muted min-w-0 flex-1 truncate text-[11px]">
              Runtime {status}
            </span>
            <span
              className={cn(
                "size-1.5 shrink-0",
                status === "connected" && "bg-emerald-500",
                status === "connecting" && "animate-pulse bg-blue-500",
                status === "disconnected" && "bg-destructive",
              )}
            />
            <UpdateAvailable />
            <ThemeMenu />
            <NavLink
              to="/settings"
              aria-label="Settings"
              className="text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-foreground flex size-8 items-center justify-center"
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
        <DialogContent>
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
              className="hover:bg-accent border px-3 py-2 text-xs"
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
              className="bg-destructive text-destructive-foreground px-3 py-2 text-xs"
            >
              Delete channel
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
