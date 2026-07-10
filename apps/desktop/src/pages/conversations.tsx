import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { Bot, Plus } from "lucide-react";
import { defaultAgents } from "@marketer/agent-runtime/agents";
import type { AgentDefinition } from "@marketer/agent-runtime/types";
import { cn } from "@marketer/ui/lib/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@marketer/ui/components/popover";
import { useRuntime } from "../lib/runtime";
import {
  createChat,
  getChatLog,
  onChatLogChange,
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
}: {
  entry: ChatLogEntry;
  active: boolean;
  running: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex w-full items-center gap-2 py-2 pr-3 pl-8 text-left text-sm transition-colors hover:bg-accent",
        active && "bg-accent text-foreground",
      )}
    >
      <span className="min-w-0 flex-1 truncate">{entry.title}</span>
      {running ? (
        <span className="size-1.5 shrink-0 animate-pulse bg-emerald-500" />
      ) : null}
    </button>
  );
}

function AgentGroup({
  agent,
  entries,
  activeChatId,
  running,
  onCreate,
  onSelect,
}: {
  agent: AgentDefinition;
  entries: ChatLogEntry[];
  activeChatId: string | null;
  running: Record<string, boolean>;
  onCreate: () => void;
  onSelect: (entry: ChatLogEntry) => void;
}) {
  return (
    <section>
      <div className="group flex items-center gap-2 px-2 py-1.5">
        <Bot size={13} className="shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-muted-foreground">
          {agent.name}
        </span>
        <button
          type="button"
          aria-label={`New ${agent.name} conversation`}
          onClick={onCreate}
          className="p-1 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100 focus:opacity-100"
        >
          <Plus size={13} />
        </button>
      </div>
      <div className="space-y-0.5">
        {entries.map((entry) => (
          <ConversationRow
            key={entry.id}
            entry={entry}
            active={entry.id === activeChatId}
            running={running[entry.id] ?? false}
            onSelect={() => onSelect(entry)}
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
  const agents = runtimeAgents.length > 0 ? runtimeAgents : defaultAgents;
  const enabledAgents = agents.filter(
    (agent) => getAgentOverride(agent.id).enabled !== false,
  );
  const [params, setParams] = useSearchParams();
  const [log, setLog] = useState<ChatLogEntry[]>(() => getChatLog());
  useEffect(() => onChatLogChange(() => setLog(getChatLog())), []);
  const running = useRunningChats();

  const activeAgentId = params.get("agent");
  const activeChatId = params.get("chat");
  const initialPrompt = params.get("prompt") ?? undefined;
  const initialDraft = params.get("draft") ?? undefined;
  const activeAgent = agents.find((agent) => agent.id === activeAgentId);
  const activeEntry = log.find(
    (entry) => entry.id === activeChatId && entry.agentId === activeAgentId,
  );

  useEffect(() => {
    if (activeAgent && activeEntry) return;
    if (activeAgent && !activeEntry) {
      const existing = log.find((entry) => entry.agentId === activeAgent.id);
      const entry = existing ?? createChat(activeAgent.id);
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          next.set("agent", activeAgent.id);
          next.set("chat", entry.id);
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
  }, [activeAgent, activeEntry, log, setParams]);

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
    setParams({ agent: agent.id, chat: entry.id });
  };

  return (
    <div className="-mb-8 flex h-[calc(100vh-48px)]">
      <aside className="flex w-72 shrink-0 flex-col border-r pr-5">
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
            />
          ))}
        </div>
      </aside>
      <main className="min-w-0 flex-1 pb-6 pl-6">
        {activeAgent && activeEntry ? (
          <AgentChat
            key={activeEntry.id}
            agent={activeAgent}
            chatId={activeEntry.id}
            initialPrompt={initialPrompt}
            initialDraft={initialDraft}
            onInitialPromptSent={() => {
              setParams(
                { agent: activeAgent.id, chat: activeEntry.id },
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
