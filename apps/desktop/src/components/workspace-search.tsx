import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeftRight,
  FileText,
  Hash,
  MessageSquare,
  MonitorCog,
  Moon,
  PenSquare,
  Search,
  Sun,
  SunMoon,
  UserPlus,
} from "lucide-react";
import { useNavigate } from "react-router";

import { isJsonObject, isJsonString } from "@chief/relay-contracts";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@chief/ui/components/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@chief/ui/components/dialog";

import { useAuth } from "../lib/auth/auth-context";
import { channelEventSourceId } from "../lib/channel-read-state";
import { useMachinesEnabled } from "../lib/experimental";
import { useRelaySession } from "../lib/relay-session";
import {
  useChannelEvents,
  useRuntime,
  useWorkspaceChannels,
} from "../lib/runtime";
import { useTheme } from "../lib/theme";
import { useStartDirectMessage } from "../lib/use-start-direct-message";
import {
  WORKSPACE_AGENT_IDENTITIES,
  WORKSPACE_CHANNELS,
} from "../lib/workspace-channels";
import { AgentAvatar } from "./agent-avatar";
import { AvatarImage } from "./avatar-image";
import { useWorkspaceUsers } from "./chat/mention-people-context";
import { OrgLogo } from "./org-logo";
import { DESTINATIONS, SETTINGS, snippet } from "./workspace-search-items";

export const OPEN_NEW_MESSAGE_EVENT = "chief:open-new-message";
export const OPEN_CHANNEL_BROWSER_EVENT = "chief:open-channel-browser";

interface SearchItem {
  id: string;
  label: string;
  hint: string;
  to: string;
  /** Runs instead of navigating, for actions like opening a dialog. */
  action?: () => void;
  /** Extra words matched but not shown. */
  keywords?: string;
  /** A workspace's logo, drawn like the workspace rail. */
  workspaceLogo?: { logo: string | null; website: string };
  icon?: typeof Search;
  image?: string;
  /** A workspace member to open a direct message with. */
  personId?: string;
  kind:
    | "Action"
    | "Destination"
    | "Channel"
    | "Message"
    | "Person"
    | "Agent"
    | "Setting"
    | "Workspace";
}

const RESULT_GROUPS = [
  "Action",
  "Person",
  "Channel",
  "Agent",
  "Message",
  "Workspace",
  "Setting",
  "Destination",
] as const;

const GROUP_LABELS: Record<SearchItem["kind"], string> = {
  Action: "Actions",
  Setting: "Settings",
  Workspace: "Workspaces",
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

function parseChannelSearchScope(value: unknown): ChannelSearchScope | null {
  if (!isJsonObject(value)) return null;
  if (!isJsonString(value.channelId) || !isJsonString(value.channelLabel)) {
    return null;
  }
  return { channelId: value.channelId, channelLabel: value.channelLabel };
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
  const { agents: runtimeAgents, agentsLoaded } = useRuntime();
  const { user } = useAuth();
  const users = useWorkspaceUsers();
  const { client, snapshot, workspaces, switchWorkspace } = useRelaySession();
  const { setPreference } = useTheme();
  const machinesEnabled = useMachinesEnabled();
  const startDirectMessage = useStartDirectMessage();
  const navigate = useNavigate();
  const [messageResults, setMessageResults] = useState<{
    query: string;
    items: SearchItem[];
  }>({ query: "", items: [] });
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [channelScope, setChannelScope] = useState<ChannelSearchScope | null>(
    null,
  );
  const { events: channelEvents } = useChannelEvents(
    channelScope?.channelId ?? null,
  );

  const items = useMemo<SearchItem[]>(() => {
    const destinations = DESTINATIONS.map((item) => ({
      ...item,
      id: item.to,
      kind: "Destination" as const,
    }));
    const channels =
      workspaceChannels.channels.length > 0
        ? workspaceChannels.channels
            .filter(
              (channel) =>
                channel.visibility !== "direct" && !channel.archivedAt,
            )
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
    const people: SearchItem[] = [...users.values()]
      .sort((left, right) =>
        left.id === user?.id
          ? 1
          : right.id === user?.id
            ? -1
            : left.name.localeCompare(right.name),
      )
      .map((person) =>
        person.id === user?.id
          ? {
              id: person.id,
              label: person.name,
              hint: "You",
              to: "/conversations?profile=user",
              image: person.image,
              kind: "Person",
            }
          : {
              id: person.id,
              label: person.name,
              hint: person.email ?? "Message",
              to: "",
              image: person.image,
              personId: person.id,
              kind: "Person",
            },
      );
    const agentRoster = agentsLoaded
      ? runtimeAgents
      : Object.entries(WORKSPACE_AGENT_IDENTITIES).map(([id, identity]) => ({
          id,
          ...identity,
        }));
    const agents: SearchItem[] = agentRoster.map((agent) => ({
      id: agent.id,
      label: agent.name,
      hint: agent.role,
      to: `/conversations?dm=${encodeURIComponent(agent.id)}`,
      kind: "Agent",
    }));
    const actions: SearchItem[] = [
      {
        id: "new-message",
        label: "New message",
        hint: "Message a person in this workspace",
        keywords: "dm direct chat start",
        to: "",
        icon: PenSquare,
        action: () => window.dispatchEvent(new Event(OPEN_NEW_MESSAGE_EVENT)),
        kind: "Action",
      },
      {
        id: "browse-channels",
        label: "Browse channels",
        hint: "Find, join or create a channel",
        keywords: "new channel create join",
        to: "",
        icon: Hash,
        action: () =>
          window.dispatchEvent(new Event(OPEN_CHANNEL_BROWSER_EVENT)),
        kind: "Action",
      },
      {
        id: "invite-people",
        label: "Invite people",
        hint: "By email or one-time link",
        keywords: "invitation link teammate member add",
        to: "/settings/workspace",
        icon: UserPlus,
        kind: "Action",
      },
      ...(
        [
          ["light", "Light theme", Sun],
          ["dark", "Dark theme", Moon],
          ["system", "System theme", SunMoon],
        ] as const
      ).map(([preference, label, icon]): SearchItem => ({
        id: `theme-${preference}`,
        label,
        hint: "Appearance",
        keywords: "theme mode appearance",
        to: "",
        icon,
        action: () => setPreference(preference),
        kind: "Action",
      })),
    ];
    const settings: SearchItem[] = [
      ...SETTINGS,
      ...(machinesEnabled
        ? [
            {
              to: "/settings/machines",
              label: "Machines",
              keywords: "computers experimental",
              icon: MonitorCog,
            },
          ]
        : []),
    ].map((setting) => ({
      id: setting.to,
      label: setting.label,
      hint: "Settings",
      keywords: setting.keywords,
      to: setting.to,
      icon: setting.icon,
      kind: "Setting" as const,
    }));
    const otherWorkspaces: SearchItem[] = workspaces
      .filter((workspace) => workspace.id !== snapshot?.id)
      .map((workspace) => ({
        id: workspace.id,
        label: `Switch to ${workspace.name}`,
        hint: "Workspace",
        to: "",
        icon: ArrowLeftRight,
        workspaceLogo: { logo: workspace.imageURL, website: workspace.website },
        action: () => void switchWorkspace(workspace.id),
        kind: "Workspace" as const,
      }));
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
    const searchable: SearchItem[] = [
      ...actions,
      ...people,
      ...channels,
      ...agents,
      ...otherWorkspaces,
      ...settings,
      ...destinations,
    ];
    if (!needle) {
      return [
        ...actions.slice(0, 3),
        ...people.slice(0, 4),
        ...channels.slice(0, 3),
        ...agents.slice(0, 3),
        ...otherWorkspaces,
        ...destinations,
      ];
    }
    const terms = needle.split(/\s+/u);
    const matches = searchable
      .filter((item) => {
        const text =
          `${item.label} ${item.hint} ${item.keywords ?? ""}`.toLocaleLowerCase();
        return terms.every((term) => text.includes(term));
      })
      .slice(0, 24);
    return messageResults.query === needle
      ? [...matches, ...messageResults.items]
      : matches;
  }, [
    channelEvents,
    channelScope,
    query,
    agentsLoaded,
    runtimeAgents,
    user,
    users,
    messageResults,
    machinesEnabled,
    setPreference,
    snapshot?.id,
    switchWorkspace,
    workspaces,
    workspaceChannels.channels,
  ]);

  // Search what people have said across every channel and DM this person can
  // read. The relay searches one conversation at a time, so fan out in
  // parallel and merge the newest matches.
  useEffect(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!open || channelScope || !client || needle.length < 2) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      const conversations = workspaceChannels.channels
        .filter((channel) => !channel.archivedAt)
        .slice(0, 40);
      void Promise.allSettled(
        conversations.map(async (channel) => ({
          channel,
          page: await client.searchMessages(channel.id, needle, { limit: 5 }),
        })),
      ).then((settled) => {
        if (cancelled) return;
        const found = settled
          .flatMap((result) =>
            result.status === "fulfilled"
              ? result.value.page.messages
                  .filter((message) => !message.deleted)
                  .map((message) => ({
                    channel: result.value.channel,
                    message,
                  }))
              : [],
          )
          .sort((left, right) =>
            right.message.createdAt.localeCompare(left.message.createdAt),
          )
          .slice(0, 12)
          .map(({ channel, message }): SearchItem => {
            const author =
              message.author.kind === "user"
                ? (users.get(message.author.id)?.name ?? "Someone")
                : message.author.kind === "agent"
                  ? (runtimeAgents.find(
                      (agent) => agent.id === message.author.id,
                    )?.name ?? "Agent")
                  : message.author.kind === "guest"
                    ? message.author.name
                    : "Chief";
            const where =
              channel.visibility === "direct"
                ? channel.name
                : `#${channel.name}`;
            return {
              id: message.id,
              label: `${author} in ${where}`,
              hint: snippet(message.body, needle),
              to: `/conversations?channel=${encodeURIComponent(channel.id)}&message=${encodeURIComponent(message.id)}`,
              icon: MessageSquare,
              kind: "Message",
            };
          });
        setMessageResults({ query: needle, items: found });
      });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    channelScope,
    client,
    open,
    query,
    runtimeAgents,
    users,
    workspaceChannels.channels,
  ]);

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
      if (!(event instanceof CustomEvent)) return;
      setChannelScope(parseChannelSearchScope(event.detail));
      setQuery("");
      setOpen(true);
    };
    window.addEventListener(OPEN_WORKSPACE_SEARCH_EVENT, openSearch);
    return () =>
      window.removeEventListener(OPEN_WORKSPACE_SEARCH_EVENT, openSearch);
  }, []);

  const choose = (item: SearchItem) => {
    setOpen(false);
    setQuery("");
    if (item.personId) {
      void startDirectMessage(item.personId);
      return;
    }
    if (item.action) {
      item.action();
      return;
    }
    void navigate(item.to);
  };

  return (
    <>
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
            Search people, channels, agents and messages in this workspace.
          </DialogDescription>
          <Command className="bg-transparent" loop shouldFilter={false}>
            <CommandInput
              ref={inputRef}
              value={query}
              onValueChange={setQuery}
              leading={
                channelScope ? (
                  <span className="bg-muted text-foreground flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium">
                    <Hash size={12} /> {channelScope.channelLabel}
                  </span>
                ) : null
              }
              placeholder={
                channelScope
                  ? `Search in #${channelScope.channelLabel}`
                  : "Search people, channels, messages, settings…"
              }
            />
            <CommandList>
              <CommandEmpty>
                <div className="flex flex-col items-center px-6 py-12 text-center">
                  <FileText size={20} className="text-muted-foreground" />
                  <p className="mt-3 text-sm font-medium">Nothing found</p>
                  <p className="text-muted-foreground mt-1 text-xs">
                    {channelScope
                      ? query.trim()
                        ? "Try another word or phrase from the conversation."
                        : "Type a word or phrase from this channel."
                      : "Try a person, channel, or something someone said."}
                  </p>
                </div>
              </CommandEmpty>
              {groupedItems.map((group) => (
                <CommandGroup
                  key={group.kind}
                  heading={GROUP_LABELS[group.kind]}
                >
                  {group.results.map((item) => {
                    const Icon = item.icon;
                    return (
                      <CommandItem
                        key={`${item.kind}-${item.id}`}
                        value={`${item.kind}-${item.id}`}
                        onSelect={() => choose(item)}
                      >
                        {item.workspaceLogo ? (
                          <OrgLogo
                            name={item.label.replace(/^Switch to /u, "")}
                            logo={item.workspaceLogo.logo}
                            website={item.workspaceLogo.website}
                            className="size-7 shrink-0 rounded-[28%] text-[11px]"
                            imgClassName="object-contain"
                            transparentWhenLoaded
                          />
                        ) : item.kind === "Agent" ? (
                          <AgentAvatar label={item.label} className="size-7" />
                        ) : item.kind === "Person" ? (
                          <span className="bg-muted flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-[28%] text-[11px] font-semibold">
                            <AvatarImage
                              className="size-full object-cover"
                              fallback={item.label
                                .charAt(0)
                                .toLocaleUpperCase()}
                              src={item.image}
                            />
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
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              ))}
            </CommandList>
          </Command>
          <div className="text-muted-foreground flex items-center gap-4 border-t px-4 py-2 text-[10px]">
            <span>↑↓ Navigate</span>
            <span>↵ Open</span>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** The sidebar's search field. The palette itself is mounted once per window. */
export function WorkspaceSearchButton() {
  return (
    <button
      type="button"
      onClick={() => openWorkspaceSearch()}
      className="border-sidebar-border/80 bg-sidebar-accent/35 text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-foreground flex h-8 w-full items-center gap-2 rounded-lg border px-2 text-left text-xs transition-colors"
    >
      <Search size={13} />
      <span className="min-w-0 flex-1 truncate">Search Chief</span>
      <kbd className="font-sans text-[10px] opacity-60">⌘K</kbd>
    </button>
  );
}
