import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { ChevronRight, MoreVertical, Plus, Trash2 } from "lucide-react";
import { defaultAgents } from "@chief/agent-runtime/agents";
import type { AgentDefinition } from "@chief/agent-runtime/types";
import { cn } from "@chief/ui/lib/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@chief/ui/components/popover";
import { useAgentPreferences, useLocalChats, useRuntime } from "../lib/runtime";
import { useAuth } from "../lib/auth/auth-context";
import {
  clearLegacyChatCache,
  createChat,
  type ChatLogEntry,
} from "../lib/chat-log";
import { getAgentOverride } from "../lib/agent-overrides";
import { AgentChat } from "../components/chat/agent-chat";

function useRunningChats(): Record<string, boolean> {
  const { client } = useRuntime();
  const [running, setRunning] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const unsubscribe = client.subscribe((message) => {
      if (message.type !== "event") return;
      const event = message.event;
      let next: boolean | undefined;
      if (event.type === "stream") next = true;
      else if (event.type === "message" && event.role === "user") next = true;
      else if (event.type === "status") next = event.status === "running";
      else if (
        event.type === "result" ||
        event.type === "error" ||
        event.type === "exit"
      ) {
        next = false;
      }
      if (next === undefined) return;
      setRunning((current) =>
        current[message.chatId] === next
          ? current
          : { ...current, [message.chatId]: next },
      );
    });
    return () => {
      unsubscribe();
    };
  }, [client]);

  return running;
}

function ConversationRow({
  entry,
  active,
  running,
  onSelect,
  onDelete,
}: {
  entry: ChatLogEntry;
  active: boolean;
  running: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div
      className={cn(
        "group/row flex w-full items-center text-sm transition-colors hover:bg-accent",
        active && "bg-accent text-foreground",
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        className="min-w-0 flex-1 truncate py-2 pr-2 pl-8 text-left"
      >
        {entry.title}
      </button>
      {running ? (
        <span className="size-1.5 shrink-0 animate-pulse bg-emerald-500" />
      ) : null}
      <Popover open={menuOpen} onOpenChange={setMenuOpen}>
        <PopoverTrigger
          aria-label={`Manage ${entry.title}`}
          className="mr-1 flex size-7 shrink-0 items-center justify-center text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover/row:opacity-100 data-[state=open]:opacity-100"
        >
          <MoreVertical size={14} />
        </PopoverTrigger>
        <PopoverContent align="end" className="w-40 p-1">
          <button
            type="button"
            onClick={() => {
              setMenuOpen(false);
              onDelete();
            }}
            className="flex w-full items-center gap-2 px-2 py-2 text-left text-xs text-destructive transition-colors hover:bg-destructive/10"
          >
            <Trash2 size={13} />
            Delete chat
          </button>
        </PopoverContent>
      </Popover>
    </div>
  );
}

function AgentGroup({
  agent,
  entries,
  activeChatId,
  running,
  onCreate,
  onSelect,
  onDelete,
}: {
  agent: AgentDefinition;
  entries: ChatLogEntry[];
  activeChatId: string | null;
  running: Record<string, boolean>;
  onCreate: () => void;
  onSelect: (entry: ChatLogEntry) => void;
  onDelete: (entry: ChatLogEntry) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <section>
      <div className="group flex items-center gap-2 px-2 py-1.5">
        <button
          type="button"
          onClick={() => setCollapsed((current) => !current)}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronRight
            size={12}
            className={cn(
              "shrink-0 transition-transform",
              !collapsed && "rotate-90",
            )}
          />
          <span className="truncate">{agent.name}</span>
        </button>
        <button
          type="button"
          aria-label={`New ${agent.name} conversation`}
          onClick={onCreate}
          className="p-1 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100 focus:opacity-100"
        >
          <Plus size={13} />
        </button>
      </div>
      <div className={cn("space-y-0.5", collapsed && "hidden")}>
        {entries.map((entry) => (
          <ConversationRow
            key={entry.id}
            entry={entry}
            active={entry.id === activeChatId}
            running={running[entry.id] ?? false}
            onSelect={() => onSelect(entry)}
            onDelete={() => onDelete(entry)}
          />
        ))}
      </div>
    </section>
  );
}

function NewConversationMenu({
  agents,
  onPick,
}: {
  agents: AgentDefinition[];
  onPick: (agent: AgentDefinition) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label="New conversation"
        className="border p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <Plus size={14} />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-60 p-1">
        {agents.map((agent) => (
          <button
            key={agent.id}
            type="button"
            onClick={() => {
              setOpen(false);
              onPick(agent);
            }}
            className="w-full px-2 py-2 text-left transition-colors hover:bg-accent"
          >
            <span className="block text-sm">{agent.name}</span>
            <span className="block text-xs text-muted-foreground">
              {agent.role}
            </span>
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

export function ConversationsPage() {
  const { agents: runtimeAgents } = useRuntime();
  const { cloudOrganizationId } = useAuth();
  const localChats = useLocalChats(cloudOrganizationId);
  const agentPreferences = useAgentPreferences(cloudOrganizationId);
  const preferences = useMemo(
    () =>
      new Map(
        agentPreferences.preferences.map((preference) => [
          preference.agentId,
          preference,
        ]),
      ),
    [agentPreferences.preferences],
  );
  const agents = (runtimeAgents.length > 0 ? runtimeAgents : defaultAgents).map(
    (agent) => ({
      ...agent,
      capabilities:
        preferences.get(agent.id)?.capabilities ?? agent.capabilities,
    }),
  );
  const enabledAgents = agents.filter(
    (agent) =>
      preferences.get(agent.id)?.enabled !== false &&
      getAgentOverride(cloudOrganizationId, agent.id).enabled !== false,
  );
  const [params, setParams] = useSearchParams();
  // The runtime database is the sole transcript index. Its chat query is
  // workspace-scoped; never merge the old browser-global cache here because
  // that exposes one organization's conversation titles in another.
  const log = localChats.chats;
  const running = useRunningChats();

  useEffect(() => clearLegacyChatCache(), []);

  const activeAgentId = params.get("agent");
  const activeChatId = params.get("chat");
  const initialPrompt = params.get("prompt") ?? undefined;
  const initialDraft = params.get("draft") ?? undefined;
  const activeAgent = agents.find((agent) => agent.id === activeAgentId);
  const activeEntry = log.find(
    (entry) => entry.id === activeChatId && entry.agentId === activeAgentId,
  );
  const isDraftChat = params.get("new") === "1";

  useEffect(() => {
    if (!activeEntry || !isDraftChat) return;
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete("new");
        next.delete("prompt");
        return next;
      },
      { replace: true },
    );
  }, [activeEntry, isDraftChat, setParams]);

  useEffect(() => {
    if (activeAgent && (activeEntry || (activeChatId && isDraftChat))) return;
    if (activeAgent && !activeChatId) {
      const existing = log.find((entry) => entry.agentId === activeAgent.id);
      const entry = existing ?? createChat(activeAgent.id);
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          next.set("agent", activeAgent.id);
          next.set("chat", entry.id);
          if (!existing) next.set("new", "1");
          return next;
        },
        { replace: true },
      );
      return;
    }
    const first = log[0];
    if (first) {
      setParams({ agent: first.agentId, chat: first.id }, { replace: true });
    }
  }, [activeAgent, activeChatId, activeEntry, isDraftChat, log, setParams]);

  const grouped = useMemo(
    () =>
      enabledAgents
        .map((agent) => ({
          agent,
          entries: log.filter((entry) => entry.agentId === agent.id),
        }))
        .filter((group) => group.entries.length > 0),
    [enabledAgents, log],
  );

  const openNew = (agent: AgentDefinition) => {
    const entry = createChat(agent.id);
    setParams({ agent: agent.id, chat: entry.id, new: "1" });
  };

  const removeChat = (entry: ChatLogEntry) => {
    const remaining = log.filter((candidate) => candidate.id !== entry.id);
    localChats.remove(entry.id);
    if (entry.id !== activeChatId) return;
    const next = remaining[0];
    setParams(next ? { agent: next.agentId, chat: next.id } : {}, {
      replace: true,
    });
  };

  return (
    <div className="-mx-8 -mb-8 flex h-[calc(100vh-48px)]">
      <aside className="flex w-72 shrink-0 flex-col border-r px-5">
        <div className="shrink-0 pt-10">
          <div className="flex items-center justify-between">
            <h1 className="font-serif text-3xl">Conversations</h1>
            <NewConversationMenu agents={enabledAgents} onPick={openNew} />
          </div>
        </div>
        <div className="mt-6 flex-1 space-y-5 overflow-y-auto pb-5">
          {grouped.map(({ agent, entries }) => (
            <AgentGroup
              key={agent.id}
              agent={agent}
              entries={entries}
              activeChatId={activeChatId}
              running={running}
              onCreate={() => openNew(agent)}
              onSelect={(entry) =>
                setParams({ agent: agent.id, chat: entry.id })
              }
              onDelete={removeChat}
            />
          ))}
        </div>
      </aside>
      <main className="min-w-0 flex-1 pb-6 pl-6">
        {activeAgent && activeChatId && (activeEntry || isDraftChat) ? (
          <AgentChat
            key={activeChatId}
            agent={activeAgent}
            chatId={activeChatId}
            isNew={isDraftChat && !activeEntry}
            composer={
              params.get("compose") === "recurring"
                ? "recurring"
                : params.get("compose") === "oneoff"
                  ? "oneoff"
                  : undefined
            }
            composerDate={params.get("date") ?? undefined}
            composerPlaybookId={params.get("playbook") ?? undefined}
            observeOnly={params.get("observe") === "1"}
            initialPrompt={initialPrompt}
            initialDraft={initialDraft}
            initialDriver={
              activeEntry?.driver ?? preferences.get(activeAgent.id)?.driver
            }
            initialModel={
              activeEntry?.model ?? preferences.get(activeAgent.id)?.model
            }
            integrations={preferences.get(activeAgent.id)?.integrations}
            onInitialPromptSent={() => {
              setParams(
                (current) => {
                  const next = new URLSearchParams(current);
                  next.delete("prompt");
                  return next;
                },
                { replace: true },
              );
            }}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Start a conversation with an agent.
          </div>
        )}
      </main>
    </div>
  );
}
