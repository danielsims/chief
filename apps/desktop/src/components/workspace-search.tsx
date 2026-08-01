import { useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarClock,
  FileText,
  FolderOpen,
  Hash,
  LayoutGrid,
  Network,
  Search,
} from "lucide-react";
import { useNavigate } from "react-router";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@chief/ui/components/dialog";
import { cn } from "@chief/ui/lib/utils";

import { useWorkspaceChannels } from "../lib/runtime";
import { WORKSPACE_CHANNELS } from "../lib/workspace-channels";

const DESTINATIONS = [
  { label: "Overview", hint: "Workspace home", to: "/", icon: LayoutGrid },
  {
    label: "Schedule",
    hint: "Recurring work",
    to: "/schedule",
    icon: CalendarClock,
  },
  { label: "Agents", hint: "Your team", to: "/agents", icon: Network },
  { label: "Files", hint: "Workspace context", to: "/files", icon: FolderOpen },
] as const;

interface SearchItem {
  id: string;
  label: string;
  hint: string;
  to: string;
  icon: typeof Search;
  kind: "Destination" | "Channel";
}

export function WorkspaceSearch() {
  const workspaceChannels = useWorkspaceChannels();
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  const items = useMemo<SearchItem[]>(() => {
    const destinations = DESTINATIONS.map((item) => ({
      ...item,
      id: item.to,
      kind: "Destination" as const,
    }));
    const channels =
      workspaceChannels.channels.length > 0
        ? workspaceChannels.channels
            .filter((channel) => channel.visibility !== "direct")
            .map((channel) => ({
              id: channel.id,
              label: `#${channel.name}`,
              hint: channel.description,
              to: `/conversations?channel=${channel.id}`,
              icon: Hash,
              kind: "Channel" as const,
            }))
        : WORKSPACE_CHANNELS.map((channel) => ({
            id: channel.id,
            label: `#${channel.label}`,
            hint: channel.description,
            to: `/conversations?channel=${channel.id}`,
            icon: Hash,
            kind: "Channel" as const,
          }));
    const needle = query.trim().toLocaleLowerCase();
    const searchable = [...destinations, ...channels];
    if (!needle) return searchable.slice(0, 12);
    return searchable
      .filter((item) =>
        `${item.label} ${item.hint}`.toLocaleLowerCase().includes(needle),
      )
      .slice(0, 12);
  }, [query, workspaceChannels.channels]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey && event.key.toLocaleLowerCase() === "k") {
        event.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const choose = (item: SearchItem) => {
    setOpen(false);
    setQuery("");
    void navigate(item.to);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="border-sidebar-border/80 bg-sidebar-accent/35 text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-foreground flex h-8 w-full items-center gap-2 rounded-lg border px-2 text-left text-xs transition-colors"
      >
        <Search size={13} />
        <span className="min-w-0 flex-1 truncate">Search Chief</span>
        <kbd className="font-sans text-[10px] opacity-60">⌘K</kbd>
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="border-border/70 bg-popover/95 [&>button:last-child]:bg-muted/60 top-[18%] translate-y-0 gap-0 overflow-hidden rounded-2xl p-0 shadow-2xl backdrop-blur-xl sm:max-w-xl [&>button:last-child]:top-[18px] [&>button:last-child]:right-4 [&>button:last-child]:rounded-md [&>button:last-child]:p-1"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            inputRef.current?.focus();
          }}
        >
          <DialogTitle className="sr-only">Search Chief</DialogTitle>
          <DialogDescription className="sr-only">
            Search channels and destinations in this workspace.
          </DialogDescription>
          <div className="flex h-12 items-center gap-3 border-b pr-12 pl-4">
            <Search size={16} className="text-muted-foreground shrink-0" />
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setActiveIndex(0);
              }}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setActiveIndex((index) =>
                    Math.min(index + 1, Math.max(0, items.length - 1)),
                  );
                } else if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setActiveIndex((index) => Math.max(0, index - 1));
                } else if (event.key === "Enter" && items[activeIndex]) {
                  event.preventDefault();
                  choose(items[activeIndex]);
                }
              }}
              placeholder="Search channels, analytics, campaigns..."
              className="placeholder:text-muted-foreground h-full min-w-0 flex-1 bg-transparent text-sm outline-none"
            />
          </div>
          <div className="max-h-[420px] overflow-y-auto p-2">
            {items.length > 0 ? (
              items.map((item, index) => {
                const Icon = item.icon;
                return (
                  <button
                    key={`${item.kind}-${item.id}`}
                    type="button"
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => choose(item)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left",
                      index === activeIndex && "bg-accent",
                    )}
                  >
                    <Icon
                      size={15}
                      strokeWidth={1.7}
                      className="text-muted-foreground shrink-0"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium">
                        {item.label}
                      </span>
                      <span className="text-muted-foreground block truncate text-[11px]">
                        {item.hint}
                      </span>
                    </span>
                    <span className="text-muted-foreground text-[10px]">
                      {item.kind}
                    </span>
                  </button>
                );
              })
            ) : (
              <div className="flex flex-col items-center px-6 py-12 text-center">
                <FileText size={20} className="text-muted-foreground" />
                <p className="mt-3 text-sm font-medium">Nothing found</p>
                <p className="text-muted-foreground mt-1 text-xs">
                  Try a channel title or workspace destination.
                </p>
              </div>
            )}
          </div>
          <div className="text-muted-foreground flex items-center gap-4 border-t px-4 py-2 text-[10px]">
            <span>↑↓ Navigate</span>
            <span>↵ Open</span>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
