import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { Plus } from "lucide-react";
import { defaultAgents } from "@marketer/agent-runtime/agents";
import type { AgentDefinition } from "@marketer/agent-runtime/types";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@marketer/ui/components/popover";
import { cn } from "@marketer/ui/lib/utils";
import { useRuntime } from "../lib/runtime";
import { getChatLog, onChatLogChange, type ChatLogEntry } from "../lib/chat-log";
import { getAgentOverride } from "../lib/agent-overrides";
import { AgentChat } from "../components/chat/agent-chat";

/**
 * Tracks which chats are mid-run by watching the runtime event stream.
 * Sessions keep streaming over the shared socket after navigation, so this
 * catches chats running in the background too.
 */
function useRunningChats(): Record<string, boolean> {
  const { client } = useRuntime();
  const [running, setRunning] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const unsub = client.subscribe((msg) => {
      if (msg.type !== "event") return;
      const e = msg.event;
      let next: boolean | undefined;
      if (e.type === "stream") next = true;
      else if (e.type === "message" && e.role === "user") next = true;
      else if (e.type === "status") next = e.status === "running";
      else if (e.type === "result" || e.type === "error" || e.type === "exit") {
        next = false;
      }
      if (next === undefined) return;
      setRunning((r) =>
        r[msg.chatId] === next ? r : { ...r, [msg.chatId]: next },
      );
    });
    return () => {
      unsub();
    };
  }, [client]);

  return running;
}

function ChatRow({
  agent,
  entry,
  active,
  running,
  onSelect,
}: {
  agent: AgentDefinition;
  entry?: ChatLogEntry;
  active: boolean;
  running: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className={cn(
        "w-full border border-transparent p-3 text-left transition-colors hover:bg-accent",
        active && "border-border bg-accent",
      )}
    >
      <span className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-sm font-medium leading-tight">
          {agent.name}
        </span>
        {running && (
          <span
            className="h-1.5 w-1.5 shrink-0 animate-pulse bg-emerald-500"
            title="Running"
          />
        )}
      </span>
      <span className="mt-0.5 block truncate text-xs text-muted-foreground">
        {entry?.lastText || "No messages yet"}
      </span>
    </button>
  );
}

function NewConversationButton({
  agents,
  onPick,
}: {
  agents: AgentDefinition[];
  onPick: (agentId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const enabled = agents.filter(
    (a) => getAgentOverride(a.id).enabled !== false,
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className="flex w-full items-center gap-2 border px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground">
        <Plus size={14} strokeWidth={1.75} />
        New conversation
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-1">
        <p className="px-2 pb-1 pt-1.5 text-xs text-muted-foreground">
          Start a chat with
        </p>
        {enabled.map((agent) => (
          <button
            key={agent.id}
            onClick={() => {
              setOpen(false);
              onPick(agent.id);
            }}
            className="w-full px-2 py-1.5 text-left transition-colors hover:bg-accent"
          >
            <span className="block text-sm leading-tight">{agent.name}</span>
            <span className="block text-xs text-muted-foreground">
              {agent.role}
            </span>
          </button>
        ))}
        {enabled.length === 0 && (
          <p className="px-2 py-1.5 text-xs text-muted-foreground">
            No agents enabled. Enable one on the Agents page.
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}

export function ConversationsPage() {
  const { agents: runtimeAgents } = useRuntime();
  // The runtime roster when connected; the static roster as a fallback so
  // the list still renders while the runtime is down.
  const agents = runtimeAgents.length > 0 ? runtimeAgents : defaultAgents;

  const [params, setParams] = useSearchParams();
  const [log, setLog] = useState<ChatLogEntry[]>(() => getChatLog());
  useEffect(() => onChatLogChange(() => setLog(getChatLog())), []);

  const running = useRunningChats();

  const chats = useMemo(
    () =>
      log
        .map((entry) => ({
          entry,
          agent: agents.find((a) => a.id === entry.agentId),
        }))
        .filter((c): c is { entry: ChatLogEntry; agent: AgentDefinition } =>
          Boolean(c.agent),
        ),
    [log, agents],
  );

  const activeId = params.get("agent") ?? chats[0]?.agent.id ?? null;
  const initialPrompt = params.get("prompt") ?? undefined;
  const active = activeId
    ? agents.find((a) => a.id === activeId)
    : undefined;

  // A chat opened via ?agent= that has no history yet still shows as a row,
  // so the selection is always visible in the list.
  const listedIds = new Set(chats.map((c) => c.agent.id));
  const unlisted =
    active && !listedIds.has(active.id) ? active : undefined;

  return (
    <div className="-mb-8 flex h-[calc(100vh-48px)]">
      <div className="flex w-72 shrink-0 flex-col border-r">
        <div className="shrink-0 pr-5 pt-10">
          <h1 className="font-serif text-3xl">Conversations</h1>
          <div className="mt-5">
            <NewConversationButton
              agents={agents}
              onPick={(agentId) => setParams({ agent: agentId })}
            />
          </div>
        </div>
        <div className="mt-3 flex-1 space-y-1 overflow-y-auto pb-4 pr-5">
          {unlisted && (
            <ChatRow
              agent={unlisted}
              active
              running={running[`${unlisted.id}-main`] ?? false}
              onSelect={() => setParams({ agent: unlisted.id })}
            />
          )}
          {chats.map(({ entry, agent }) => (
            <ChatRow
              key={agent.id}
              agent={agent}
              entry={entry}
              active={agent.id === activeId}
              running={running[`${agent.id}-main`] ?? false}
              onSelect={() => setParams({ agent: agent.id })}
            />
          ))}
          {chats.length === 0 && !unlisted && (
            <p className="p-3 text-xs text-muted-foreground">
              No conversations yet. Start one above.
            </p>
          )}
        </div>
      </div>
      <div className="min-w-0 flex-1 pb-6 pl-6">
        {active ? (
          <AgentChat
            key={active.id}
            agent={active}
            initialPrompt={initialPrompt}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Select a conversation or start a new one.
          </div>
        )}
      </div>
    </div>
  );
}
