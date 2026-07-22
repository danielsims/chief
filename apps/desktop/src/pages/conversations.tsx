import { startTransition, useEffect, useState } from "react";
import { LoaderCircle, MoreVertical, Plus, Trash2 } from "lucide-react";
import { useSearchParams } from "react-router";

import type { DriverType } from "@chief/agent-runtime/types";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@chief/ui/components/popover";
import { cn } from "@chief/ui/lib/utils";

import type { ChatLogEntry } from "../lib/chat-log";
import { BrowserPanel } from "../components/chat/browser-panel";
import { ChiefChat } from "../components/chat/chief-chat";
import { IntegrationSetupConversation } from "../components/chat/integration-setup-conversation";
import { ObservedChat } from "../components/chat/observed-chat";
import { useAuth } from "../lib/auth/auth-context";
import { createChat } from "../lib/chat-log";
import {
  googleAnalyticsActionIdFromChat,
  integrationSetupDomainFromChat,
} from "../lib/integration-setup";
import { useLocalChats, useRuntime, useWorkspaceData } from "../lib/runtime";

const CHAT_DRIVERS = new Set<DriverType>([
  "claude",
  "codex",
  "opencode",
  "remote",
]);

function requestedDriver(value: string | null): DriverType | undefined {
  return value && CHAT_DRIVERS.has(value as DriverType)
    ? (value as DriverType)
    : undefined;
}

function useRunningChats(): Record<string, boolean> {
  const { client } = useRuntime();
  const [running, setRunning] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const unsubscribe = client.subscribe((message) => {
      if (message.type === "message" && message.message.role === "user") {
        setRunning((current) => ({
          ...current,
          [message.chatId]: true,
        }));
        return;
      }
      if (message.type !== "event") return;
      const event = message.event;
      const next =
        event.type === "stream" ||
        (event.type === "message" && event.role === "user") ||
        (event.type === "status" && event.status === "running")
          ? true
          : event.type === "result" ||
              event.type === "error" ||
              event.type === "exit" ||
              (event.type === "status" && event.status !== "running")
            ? false
            : undefined;
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
        "group/row hover:bg-accent flex w-full items-center text-sm transition-colors",
        active && "bg-accent text-foreground",
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        className="min-w-0 flex-1 truncate py-2 pr-2 pl-3 text-left"
      >
        {entry.title}
      </button>
      {running ? (
        <span
          className="text-muted-foreground mr-1 flex size-7 shrink-0 items-center justify-center"
          aria-label={`${entry.title} is running`}
        >
          <LoaderCircle className="animate-spin" size={13} />
        </span>
      ) : (
        <Popover open={menuOpen} onOpenChange={setMenuOpen}>
          <PopoverTrigger
            aria-label={`Manage ${entry.title}`}
            className="text-muted-foreground hover:text-foreground mr-1 flex size-7 shrink-0 items-center justify-center opacity-0 transition-opacity group-hover/row:opacity-100 data-[state=open]:opacity-100"
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
              className="text-destructive hover:bg-destructive/10 flex w-full items-center gap-2 px-2 py-2 text-left text-xs transition-colors"
            >
              <Trash2 size={13} />
              Delete chat
            </button>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}

export function ConversationsPage() {
  const { cloudOrganizationId } = useAuth();
  const localChats = useLocalChats(cloudOrganizationId);
  const workspaceData = useWorkspaceData(cloudOrganizationId);
  const [params, setParams] = useSearchParams();
  const running = useRunningChats();
  const { browserUrl, browserConversationId, browserWorkspaceId } =
    useRuntime();
  const activeChatId = params.get("chat");
  const activeChildId = params.get("child");
  const activeSetupActionId = googleAnalyticsActionIdFromChat(activeChatId);
  const activeSetupDomain = integrationSetupDomainFromChat(activeChatId);
  const activeEntry = localChats.chats.find(
    (entry) => entry.id === activeChatId,
  );
  const isNew = Boolean(activeChatId && !localChats.loading && !activeEntry);
  const activeChild = workspaceData.activity.find(
    (session) =>
      session.id === activeChildId && session.parentId === activeChatId,
  );

  useEffect(() => {
    const first = localChats.chats[0];
    if (activeChatId || !first) return;
    setParams({ chat: first.id }, { replace: true });
  }, [activeChatId, localChats.chats, setParams]);

  const selectChat = (chatId: string) => {
    startTransition(() => setParams({ chat: chatId }));
  };
  const openNew = () => {
    const chat = createChat();
    startTransition(() => setParams({ chat: chat.id }));
  };
  const removeChat = (entry: ChatLogEntry) => {
    const next = localChats.chats.find((chat) => chat.id !== entry.id);
    localChats.remove(entry.id);
    if (entry.id === activeChatId) {
      startTransition(() =>
        setParams(next ? { chat: next.id } : {}, { replace: true }),
      );
    }
  };

  return (
    <div className="-mx-4 -mb-4 flex h-[calc(100vh-48px)] min-w-0 flex-col sm:-mx-8 sm:-mb-8 sm:flex-row">
      <aside className="flex max-h-48 shrink-0 flex-col border-b px-4 sm:max-h-none sm:w-72 sm:border-r sm:border-b-0 sm:px-5">
        <div className="shrink-0 pt-4 sm:pt-10">
          <div className="flex items-center justify-between gap-3">
            <h1 className="font-serif text-3xl">Conversations</h1>
            <button
              type="button"
              onClick={openNew}
              aria-label="New chat"
              title="New chat"
              className="text-muted-foreground hover:bg-accent hover:text-foreground flex size-9 shrink-0 items-center justify-center border transition-colors"
            >
              <Plus size={14} />
            </button>
          </div>
        </div>
        <div className="mt-3 flex-1 space-y-0.5 overflow-y-auto pb-3 sm:mt-6 sm:pb-5">
          {localChats.chats.map((entry) => (
            <ConversationRow
              key={entry.id}
              entry={entry}
              active={entry.id === activeChatId}
              running={running[entry.id] ?? entry.running}
              onSelect={() => selectChat(entry.id)}
              onDelete={() => removeChat(entry)}
            />
          ))}
        </div>
      </aside>
      <main className="flex min-h-0 min-w-0 flex-1 flex-col px-4 pb-4 sm:pb-6 sm:pl-6 lg:flex-row">
        <div
          className={cn(
            "min-h-0 min-w-0 flex-1",
            browserUrl &&
              browserWorkspaceId === cloudOrganizationId &&
              browserConversationId === activeChatId &&
              "lg:basis-1/2 lg:pr-4",
          )}
        >
          {activeChatId && activeChild ? (
            <ObservedChat
              key={activeChild.id}
              chatId={activeChild.id}
              label={
                <div className="flex min-w-0 items-center justify-start gap-2 px-4">
                  <button
                    type="button"
                    className="hover:text-foreground max-w-[40%] truncate transition-colors"
                    onClick={() => setParams({ chat: activeChatId })}
                  >
                    {activeEntry?.title ?? "Chief"}
                  </button>
                  <span aria-hidden>/</span>
                  <strong className="text-foreground truncate font-medium">
                    {activeChild.title}
                  </strong>
                </div>
              }
            />
          ) : activeChatId && activeSetupDomain ? (
            <IntegrationSetupConversation
              key={activeChatId}
              chatId={activeChatId}
              domain={activeSetupDomain}
              actionId={activeSetupActionId ?? undefined}
            />
          ) : activeChatId ? (
            <ChiefChat
              key={activeChatId}
              chatId={activeChatId}
              isNew={isNew}
              initialDriver={
                activeEntry?.driver ??
                (isNew ? requestedDriver(params.get("driver")) : undefined)
              }
              initialModel={
                activeEntry?.model ??
                (isNew ? (params.get("model") ?? undefined) : undefined)
              }
              composer={
                params.get("compose") === "recurring"
                  ? "recurring"
                  : params.get("compose") === "oneoff"
                    ? "oneoff"
                    : undefined
              }
              composerDate={params.get("date") ?? undefined}
              composerPlaybookId={params.get("playbook") ?? undefined}
              initialPrompt={params.get("prompt") ?? undefined}
              initialDraft={params.get("draft") ?? undefined}
              onInitialPromptSent={() => {
                setParams(
                  (current) => {
                    const next = new URLSearchParams(current);
                    next.delete("prompt");
                    next.delete("driver");
                    next.delete("model");
                    return next;
                  },
                  { replace: true },
                );
              }}
              onOpenChild={(childId) =>
                setParams({ chat: activeChatId, child: childId })
              }
            />
          ) : (
            <div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-3 text-center text-sm">
              <p className="font-serif text-3xl text-current">Ask Chief</p>
              <p>Start a chat and Chief will bring in the right specialist.</p>
              <button
                type="button"
                onClick={openNew}
                className="text-foreground hover:bg-accent border px-3 py-2 text-xs transition-colors"
              >
                New chat
              </button>
            </div>
          )}
        </div>
        {activeChatId &&
        browserUrl &&
        browserWorkspaceId === cloudOrganizationId &&
        browserConversationId === activeChatId ? (
          <div className="h-[45%] min-h-64 min-w-0 lg:h-full lg:basis-1/2">
            <BrowserPanel
              operating={running[activeChatId] ?? activeEntry?.running ?? false}
            />
          </div>
        ) : null}
      </main>
    </div>
  );
}
