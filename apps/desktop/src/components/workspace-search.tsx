import { useEffect, useMemo, useRef, useState } from "react";
import {
  BarChart3,
  CalendarClock,
  FileText,
  FolderOpen,
  Hash,
  LayoutGrid,
  MessageSquare,
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

import { useAuth } from "../lib/auth/auth-context";
import { channelEventSourceId } from "../lib/channel-read-state";
import { useChannelEvents, useWorkspaceChannels } from "../lib/runtime";
import {
  WORKSPACE_AGENT_IDENTITIES,
  WORKSPACE_CHANNELS,
} from "../lib/workspace-channels";
import { AgentAvatar } from "./agent-avatar";

const DESTINATIONS = [
  { label: "Overview", hint: "Workspace home", to: "/", icon: LayoutGrid },
  {
    label: "Schedule",
    hint: "Recurring work",
    to: "/schedule",
    icon: CalendarClock,
  },
  { label: "Agents", hint: "Your team", to: "/agents", icon: Network },
  {
    label: "Analytics",
    hint: "Measurement and reporting",
    to: "/analytics",
    icon: BarChart3,
  },
  { label: "Files", hint: "Workspace context", to: "/files", icon: FolderOpen },
] as const;

interface SearchItem {
  id: string;
  label: string;
  hint: string;
  to: string;
  icon?: typeof Search;
  image?: string;
  kind: "Destination" | "Channel" | "Message" | "Person" | "Agent";
}

const RESULT_GROUPS = [
  "Message",
  "Channel",
  "Person",
  "Agent",
  "Destination",
] as const;

const GROUP_LABELS: Record<SearchItem["kind"], string> = {
  Channel: "Channels",
  Message: "Messages",
  Person: "People",
  Agent: "Agents",
  Destination: "Chief",
};

interface ChannelSearchScope {
  channelId: string;
  channelLabel: string;
}

const OPEN_WORKSPACE_SEARCH_EVENT = "chief:open-workspace-search";

export function openWorkspaceSearch(scope?: ChannelSearchScope) {
  window.dispatchEvent(
    new CustomEvent<ChannelSearchScope | undefined>(
      OPEN_WORKSPACE_SEARCH_EVENT,
      { detail: scope },
    ),
  );
}

export function WorkspaceSearch() {
  const workspaceChannels = useWorkspaceChannels();
  const { user } = useAuth();
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [channelScope, setChannelScope] = useState<ChannelSearchScope | null>(
    null,
  );
  const channelEvents = useChannelEvents(channelScope?.channelId ?? null);

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
    const people: SearchItem[] = user
      ? [
          {
            id: user.id,
            label: user.name,
            hint: user.email,
            to: "/conversations?profile=user",
            image: user.image,
            kind: "Person",
          },
        ]
      : [];
    const agents: SearchItem[] = Object.entries(WORKSPACE_AGENT_IDENTITIES).map(
      ([id, identity]) => ({
        id,
        label: identity.name,
        hint: identity.role,
        to: `/conversations?dm=${id}`,
        kind: "Agent",
      }),
    );
    const needle = query.trim().toLocaleLowerCase();
    if (channelScope) {
      if (!needle) return [];
      return channelEvents
        .filter((event) => event.kind === 9)
        .map((event): SearchItem => {
          const messageId = channelEventSourceId(event) ?? event.id;
          return {
            id: event.id,
            label: event.actor.name,
            hint: event.content.replace(/\s+/g, " ").trim(),
            to: `/conversations?channel=${encodeURIComponent(channelScope.channelId)}&message=${encodeURIComponent(messageId)}`,
            icon: MessageSquare,
            kind: "Message",
          };
        })
        .filter((item) =>
          `${item.label} ${item.hint}`.toLocaleLowerCase().includes(needle),
        )
        .slice(-50)
        .reverse();
    }
    const searchable = [...channels, ...people, ...agents, ...destinations];
    if (!needle) {
      return [
        ...channels.slice(0, 3),
        ...people,
        ...agents.slice(0, 3),
        ...destinations,
      ];
    }
    return searchable
      .filter((item) =>
        `${item.label} ${item.hint}`.toLocaleLowerCase().includes(needle),
      )
      .slice(0, 18);
  }, [channelEvents, channelScope, query, user, workspaceChannels.channels]);

  const groupedItems = useMemo(
    () =>
      RESULT_GROUPS.flatMap((kind) => {
        const results = items.filter((item) => item.kind === kind);
        return results.length > 0 ? [{ kind, results }] : [];
      }),
    [items],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey && event.key.toLocaleLowerCase() === "k") {
        event.preventDefault();
        setChannelScope(null);
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    const openSearch = (event: Event) => {
      const customEvent = event as CustomEvent<ChannelSearchScope | undefined>;
      setChannelScope(customEvent.detail ?? null);
      setQuery("");
      setActiveIndex(0);
      setOpen(true);
    };
    window.addEventListener(OPEN_WORKSPACE_SEARCH_EVENT, openSearch);
    return () =>
      window.removeEventListener(OPEN_WORKSPACE_SEARCH_EVENT, openSearch);
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
        onClick={() => {
          setChannelScope(null);
          setOpen(true);
        }}
        className="border-sidebar-border/80 bg-sidebar-accent/35 text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-foreground flex h-8 w-full items-center gap-2 rounded-lg border px-2 text-left text-xs transition-colors"
      >
        <Search size={13} />
        <span className="min-w-0 flex-1 truncate">Search Chief</span>
        <kbd className="font-sans text-[10px] opacity-60">⌘K</kbd>
      </button>
      <Dialog
        open={open}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
          if (!nextOpen) {
            setChannelScope(null);
            setQuery("");
          }
        }}
      >
        <DialogContent
          className="border-border/70 bg-popover/95 top-[18%] translate-y-0 gap-0 overflow-hidden rounded-2xl p-0 shadow-2xl backdrop-blur-xl sm:max-w-2xl [&>button:last-child]:hidden"
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
            {channelScope ? (
              <span className="bg-muted text-foreground flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium">
                <Hash size={12} /> {channelScope.channelLabel}
              </span>
            ) : null}
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
              placeholder={
                channelScope
                  ? `Search in #${channelScope.channelLabel}`
                  : "Search channels, people, agents, and Chief..."
              }
              className="placeholder:text-muted-foreground h-full min-w-0 flex-1 bg-transparent text-sm outline-none"
            />
          </div>
          <div className="max-h-[420px] overflow-y-auto p-2">
            {items.length > 0 ? (
              groupedItems.map((group) => (
                <section key={group.kind}>
                  <p className="text-muted-foreground/75 px-3 pt-2 pb-1.5 text-xs font-medium">
                    {GROUP_LABELS[group.kind]}
                  </p>
                  {group.results.map((item) => {
                    const index = items.indexOf(item);
                    const Icon = item.icon;
                    return (
                      <button
                        key={`${item.kind}-${item.id}`}
                        type="button"
                        onMouseEnter={() => setActiveIndex(index)}
                        onClick={() => choose(item)}
                        className={cn(
                          "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors",
                          index === activeIndex
                            ? "bg-muted/55"
                            : "hover:bg-muted/35",
                        )}
                      >
                        {item.kind === "Agent" ? (
                          <AgentAvatar label={item.label} className="size-7" />
                        ) : item.kind === "Person" ? (
                          <span className="bg-muted flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-full text-[11px] font-semibold">
                            {item.image ? (
                              <img
                                src={item.image}
                                alt=""
                                className="size-full object-cover"
                              />
                            ) : (
                              item.label.charAt(0).toLocaleUpperCase()
                            )}
                          </span>
                        ) : Icon ? (
                          <span className="text-muted-foreground flex size-7 shrink-0 items-center justify-center">
                            <Icon size={16} strokeWidth={1.7} />
                          </span>
                        ) : null}
                        <span className="min-w-0 flex-1 space-y-0.5">
                          <span className="block truncate text-sm font-semibold">
                            {item.label}
                          </span>
                          <span className="text-muted-foreground block truncate text-xs">
                            {item.hint}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </section>
              ))
            ) : (
              <div className="flex flex-col items-center px-6 py-12 text-center">
                <FileText size={20} className="text-muted-foreground" />
                <p className="mt-3 text-sm font-medium">Nothing found</p>
                <p className="text-muted-foreground mt-1 text-xs">
                  {channelScope
                    ? query.trim()
                      ? "Try another word or phrase from the conversation."
                      : "Type a word or phrase from this channel."
                    : "Try a channel title or workspace destination."}
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
