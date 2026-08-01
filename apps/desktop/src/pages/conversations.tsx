import { lazy, startTransition, Suspense, useEffect, useState } from "react";
import {
  Check,
  Copy,
  Hash,
  MoreHorizontal,
  PanelRightClose,
} from "lucide-react";
import { useSearchParams } from "react-router";

import type { DriverType } from "@chief/agent-runtime/types";
import { Button } from "@chief/ui/components/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@chief/ui/components/popover";
import { cn } from "@chief/ui/lib/utils";

import { ChannelArtifactsMenu } from "../components/channel-artifacts-menu";
import { ChiefChat } from "../components/chat/chief-chat";
import { IntegrationSetupConversation } from "../components/chat/integration-setup-conversation";
import { ObservedChat } from "../components/chat/observed-chat";
import { useAuth } from "../lib/auth/auth-context";
import {
  googleAnalyticsActionIdFromChat,
  integrationSetupDomainFromChat,
} from "../lib/integration-setup";
import { useLocalChats, useRuntime, useWorkspaceData } from "../lib/runtime";
import {
  channelChatId,
  WORKSPACE_CHANNELS,
  workspaceChannel,
} from "../lib/workspace-channels";

const CHAT_DRIVERS = new Set<DriverType>([
  "claude",
  "codex",
  "opencode",
  "remote",
]);

const CHANNEL_AGENT_IDENTITIES: Record<string, { name: string; role: string }> =
  {
    cmo: { name: "Chief", role: "Chief marketing officer" },
    analyst: { name: "Analyst", role: "Measurement and reporting" },
    ads: { name: "Advertising", role: "Paid acquisition" },
    content: { name: "Content", role: "Content and creative" },
    prospector: { name: "Prospector", role: "Research and outreach" },
    brand: { name: "Brand", role: "Brand research" },
  };

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
  const { cloudOrganizationId, user } = useAuth();
  const localChats = useLocalChats(cloudOrganizationId);
  const workspaceData = useWorkspaceData(cloudOrganizationId);
  const [params, setParams] = useSearchParams();
  const [channelLinkCopied, setChannelLinkCopied] = useState(false);
  const running = useRunningChats();
  const { browserUrl, browserConversationId, browserWorkspaceId } =
    useRuntime();
  const requestedChannel = workspaceChannel(params.get("channel"));
  const activeChannel = requestedChannel ?? WORKSPACE_CHANNELS[3];
  const activeChatId = requestedChannel
    ? channelChatId(requestedChannel.id)
    : params.get("chat");
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
  const continueArtifact = (artifact: { id: string; title: string }) => {
    startTransition(() =>
      setParams({
        channel: activeChannel.id,
        prompt: `Open the output “${artifact.title}” (${artifact.id}) and help me improve it.`,
      }),
    );
  };

  return (
    <div className="bg-background flex h-full min-w-0 flex-col overflow-hidden">
      <header className="border-border/60 relative flex h-14 shrink-0 items-center border-b px-5">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Hash size={17} className="text-muted-foreground shrink-0" />
          <div className="min-w-0">
            <h1 className="truncate text-[13px] leading-4 font-semibold">
              {activeChannel.label}
            </h1>
            <p className="text-muted-foreground mt-0.5 truncate text-[12px] leading-4 font-normal">
              {activeChannel.description}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <ChannelArtifactsMenu
            channelId={activeChannel.id}
            onContinue={continueArtifact}
          />
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label={`${activeChannel.agentIds.length + 1} channel members`}
                title="Channel members"
                className="bg-card hover:bg-accent flex h-8 items-center rounded-lg px-2 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_8%,transparent)] transition-colors"
              >
                <span className="flex -space-x-1">
                  {user?.image ? (
                    <img
                      src={user.image}
                      alt=""
                      className="ring-card size-4 rounded-full object-cover ring-1"
                    />
                  ) : null}
                  {activeChannel.agentIds.slice(0, 3).map((agentId) => (
                    <span
                      key={agentId}
                      className="bg-muted text-muted-foreground ring-card flex size-4 items-center justify-center rounded-full text-[7px] font-medium ring-1"
                    >
                      {CHANNEL_AGENT_IDENTITIES[agentId]?.name
                        .charAt(0)
                        .toLocaleUpperCase() ?? "A"}
                    </span>
                  ))}
                </span>
                <span className="text-muted-foreground ml-1.5 text-[10px]">
                  {activeChannel.agentIds.length + 1}
                </span>
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-64 p-1.5">
              <div className="px-2 pt-1.5 pb-2">
                <p className="text-xs font-medium">#{activeChannel.label}</p>
                <p className="text-muted-foreground mt-0.5 text-[11px]">
                  People and agents sharing this context.
                </p>
              </div>
              <div className="space-y-0.5">
                <div className="flex items-center gap-2.5 rounded-lg px-2 py-2">
                  <span className="bg-muted flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-full text-[9px] font-medium">
                    {user?.image ? (
                      <img
                        src={user.image}
                        alt=""
                        className="size-full object-cover"
                      />
                    ) : (
                      (user?.name.charAt(0) ?? "Y").toLocaleUpperCase()
                    )}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-medium">
                      {user?.name ?? "You"}
                    </span>
                    <span className="text-muted-foreground block text-[10px]">
                      You
                    </span>
                  </span>
                </div>
                {activeChannel.agentIds.map((agentId) => {
                  const identity = CHANNEL_AGENT_IDENTITIES[agentId] ?? {
                    name: agentId,
                    role: "Agent",
                  };
                  return (
                    <div
                      key={agentId}
                      className="flex items-center gap-2.5 rounded-lg px-2 py-2"
                    >
                      <span className="bg-foreground text-background flex size-7 shrink-0 items-center justify-center rounded-lg text-[9px] font-semibold">
                        {identity.name.charAt(0).toLocaleUpperCase()}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-xs font-medium">
                          {identity.name}
                        </span>
                        <span className="text-muted-foreground block truncate text-[10px]">
                          {identity.role}
                        </span>
                      </span>
                    </div>
                  );
                })}
              </div>
            </PopoverContent>
          </Popover>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                aria-label="Channel actions"
                title="Channel actions"
                variant="outline"
                size="icon-sm"
              >
                <MoreHorizontal size={15} />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-48 p-1.5">
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard.writeText(window.location.href);
                  setChannelLinkCopied(true);
                  window.setTimeout(() => setChannelLinkCopied(false), 1600);
                }}
                className="hover:bg-accent flex h-9 w-full items-center gap-2 rounded-lg px-2 text-left text-xs transition-colors"
              >
                {channelLinkCopied ? <Check size={14} /> : <Copy size={14} />}
                {channelLinkCopied
                  ? "Channel link copied"
                  : "Copy channel link"}
              </button>
            </PopoverContent>
          </Popover>
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
              channel={requestedChannel ?? undefined}
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
                setParams((current) => {
                  const next = new URLSearchParams(current);
                  next.set("channel", activeChannel.id);
                  next.set("chat", activeChatId);
                  next.set("child", childId);
                  return next;
                })
              }
            />
          ) : (
            <div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-3 text-center text-sm">
              <span className="border-border bg-card flex size-10 items-center justify-center rounded-xl border">
                <Hash size={18} />
              </span>
              <p className="font-serif text-3xl text-current">
                #{activeChannel.label}
              </p>
              <p>{activeChannel.description}</p>
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
                      #{activeChannel.label}
                    </span>
                    <span className="px-1.5" aria-hidden>
                      /
                    </span>
                    <strong className="text-foreground font-medium">
                      {activeChild.title}
                    </strong>
                  </span>
                  <Button
                    aria-label="Close thread"
                    onClick={() =>
                      setParams((current) => {
                        const next = new URLSearchParams(current);
                        next.delete("child");
                        return next;
                      })
                    }
                    variant="ghost"
                    size="icon-xs"
                  >
                    <PanelRightClose size={14} />
                  </Button>
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
