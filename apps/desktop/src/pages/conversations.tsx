import { lazy, startTransition, Suspense, useEffect, useState } from "react";
import {
  Hash,
  MoreHorizontal,
  PanelRightClose,
  Plus,
  Sparkles,
  Users,
} from "lucide-react";
import { useSearchParams } from "react-router";

import type { DriverType } from "@chief/agent-runtime/types";
import { cn } from "@chief/ui/lib/utils";

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

const BrowserPanel = lazy(() =>
  import("../components/chat/browser-panel").then((module) => ({
    default: module.BrowserPanel,
  })),
);

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
  const hasBrowserPanel =
    Boolean(browserUrl) &&
    browserWorkspaceId === cloudOrganizationId &&
    browserConversationId === activeChatId;
  const hasAuxiliaryPanel = activeChild !== undefined || hasBrowserPanel;

  const openNew = () => {
    const chat = createChat();
    startTransition(() => setParams({ chat: chat.id }));
  };
  const channelTitle =
    activeEntry?.title ?? (activeChatId ? "New channel" : "Channels");

  return (
    <div className="bg-background flex h-full min-w-0 flex-col overflow-hidden">
      <header className="border-border/70 relative flex h-14 shrink-0 items-center border-b px-5">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Hash size={17} className="text-muted-foreground shrink-0" />
          <div className="min-w-0">
            <h1 className="truncate text-[14px] leading-4 font-semibold">
              {channelTitle}
            </h1>
            <p className="text-muted-foreground mt-0.5 truncate text-[10px]">
              Chief and its specialists work here with you
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="border-border/70 bg-card flex h-8 items-center gap-1 rounded-lg border px-2">
            <span className="bg-foreground text-background flex size-4 items-center justify-center rounded-md text-[8px] font-semibold">
              C
            </span>
            <span className="bg-muted text-muted-foreground flex size-4 items-center justify-center rounded-md">
              <Sparkles size={9} />
            </span>
            <span className="text-muted-foreground ml-0.5 text-[10px]">2</span>
          </div>
          <button
            type="button"
            aria-label="Channel members"
            className="text-muted-foreground hover:bg-accent hover:text-foreground border-border/70 flex size-8 items-center justify-center rounded-lg border"
          >
            <Users size={14} />
          </button>
          <button
            type="button"
            aria-label="Channel actions"
            className="text-muted-foreground hover:bg-accent hover:text-foreground border-border/70 flex size-8 items-center justify-center rounded-lg border"
          >
            <MoreHorizontal size={15} />
          </button>
        </div>
      </header>
      <main className="flex min-h-0 min-w-0 flex-1 flex-col lg:flex-row">
        <section
          className={cn(
            "min-h-0 min-w-0 flex-1 px-5 pb-5",
            hasAuxiliaryPanel && "lg:basis-1/2 lg:pr-4",
          )}
        >
          {activeChatId && activeSetupDomain ? (
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
              <span className="border-border bg-card flex size-10 items-center justify-center border">
                <Hash size={18} />
              </span>
              <p className="font-serif text-3xl text-current">Open a channel</p>
              <p>Give Chief a goal and the right specialists will join in.</p>
              <button
                type="button"
                onClick={openNew}
                className="text-foreground hover:bg-accent flex items-center gap-2 border px-3 py-2 text-xs transition-colors"
              >
                <Plus size={13} /> New channel
              </button>
            </div>
          )}
        </section>
        {activeChatId && activeChild ? (
          <aside className="border-border/70 bg-background min-h-0 min-w-[360px] basis-[42%] border-l">
            <ObservedChat
              key={activeChild.id}
              chatId={activeChild.id}
              label={
                <div className="flex min-w-0 items-center gap-2 px-4">
                  <span className="min-w-0 flex-1 truncate">
                    <span className="text-muted-foreground">
                      {activeEntry?.title ?? "Chief"}
                    </span>
                    <span className="px-1.5" aria-hidden>
                      /
                    </span>
                    <strong className="text-foreground font-medium">
                      {activeChild.title}
                    </strong>
                  </span>
                  <button
                    type="button"
                    aria-label="Close thread"
                    onClick={() => setParams({ chat: activeChatId })}
                    className="hover:bg-accent hover:text-foreground flex size-7 shrink-0 items-center justify-center rounded-md"
                  >
                    <PanelRightClose size={14} />
                  </button>
                </div>
              }
            />
          </aside>
        ) : activeChatId &&
          browserUrl &&
          browserWorkspaceId === cloudOrganizationId &&
          browserConversationId === activeChatId ? (
          <aside className="border-border/70 h-[45%] min-h-64 min-w-0 border-l lg:h-full lg:basis-1/2">
            <Suspense fallback={<div className="bg-card size-full" />}>
              <BrowserPanel
                operating={
                  running[activeChatId] ?? activeEntry?.running ?? false
                }
              />
            </Suspense>
          </aside>
        ) : null}
      </main>
    </div>
  );
}
