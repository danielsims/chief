import { useMemo, useState } from "react";
import { ArrowUpRight, CheckCheck, Inbox, MessageSquare } from "lucide-react";

import { messagePreviewText } from "@chief/relay-contracts";
import { Button } from "@chief/ui/components/button";
import { cn } from "@chief/ui/lib/utils";

import type { ChannelInboxMessage } from "../lib/channel-inbox";
import { AgentAvatar } from "../components/agent-avatar";
import { AttentionPill } from "../components/attention-pill";
import { StreamingMarkdown } from "../components/chat/streaming-markdown";
import { PageTitle } from "../components/page-title";
import { useAuth } from "../lib/auth/auth-context";
import { channelIdsNeedingUser } from "../lib/channel-action-items";
import { useChannelReadState } from "../lib/channel-read-state-context";
import { useChiefNavigation } from "../lib/chief-navigation-context";
import { useWorkspaceChannels, useWorkspaceData } from "../lib/runtime";

type InboxFilter = "all" | "unread" | "needs-you";

function relativeTime(timestamp: number) {
  const elapsed = Date.now() - timestamp;
  const minutes = Math.max(1, Math.round(elapsed / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  return `${days}d`;
}

function messageDestination(
  message: ChannelInboxMessage,
  channel: {
    id: string;
    slug: string;
    visibility?: string;
    agentIds: readonly string[];
  },
) {
  return {
    kind: "conversation" as const,
    channelId: channel.id,
    channelSlug: channel.slug,
    directAgentId:
      channel.visibility === "direct" ? channel.agentIds[0] : undefined,
    threadRootId: message.threadSourceId,
    messageId: message.sourceId ?? message.id,
  };
}

export function InboxPage() {
  const chiefNavigation = useChiefNavigation();
  const { cloudOrganizationId } = useAuth();
  const { inboxMessages, markChannelRead, markThreadRead } =
    useChannelReadState();
  const { channels } = useWorkspaceChannels();
  const workspaceData = useWorkspaceData(cloudOrganizationId);
  const [filter, setFilter] = useState<InboxFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const channelsById = useMemo(
    () => new Map(channels.map((channel) => [channel.id, channel])),
    [channels],
  );
  const channelsNeedingUser = useMemo(
    () =>
      channelIdsNeedingUser({
        actionItems: workspaceData.actionItems,
        sessions: workspaceData.activity,
        recurringWork: workspaceData.recurringWork,
        channelIds: channels.map((channel) => channel.id),
      }),
    [
      channels,
      workspaceData.actionItems,
      workspaceData.activity,
      workspaceData.recurringWork,
    ],
  );
  const needsUserMessageIds = useMemo(() => {
    const latestByChannel = new Map<string, string>();
    for (const message of inboxMessages) {
      if (
        channelsNeedingUser.has(message.channelId) &&
        !latestByChannel.has(message.channelId)
      ) {
        latestByChannel.set(message.channelId, message.id);
      }
    }
    return new Set(latestByChannel.values());
  }, [channelsNeedingUser, inboxMessages]);
  const filteredMessages = useMemo(
    () =>
      inboxMessages.filter((message) => {
        if (filter === "unread") return message.unread;
        if (filter === "needs-you") return needsUserMessageIds.has(message.id);
        return true;
      }),
    [filter, inboxMessages, needsUserMessageIds],
  );
  const selected =
    filteredMessages.find((message) => message.id === selectedId) ??
    filteredMessages[0] ??
    null;
  const selectedChannel = selected
    ? channelsById.get(selected.channelId)
    : undefined;

  const openMessage = (message: ChannelInboxMessage) => {
    const channel = channelsById.get(message.channelId);
    if (!channel) return;
    chiefNavigation.open(messageDestination(message, channel));
  };
  const markSelectedRead = () => {
    if (!selected) return;
    if (selected.rootId) {
      markThreadRead(selected.channelId, selected.rootId);
    } else {
      markChannelRead(selected.channelId);
    }
  };

  return (
    <div className="-mx-8 -mb-8 flex h-[calc(100vh-48px)] min-h-0 flex-col overflow-hidden">
      <header className="border-border/60 flex shrink-0 items-end justify-between gap-4 border-b px-7 py-5">
        <div>
          <PageTitle>Inbox</PageTitle>
          <p className="text-muted-foreground mt-1 text-sm">
            Messages and handoffs that arrived while you were elsewhere.
          </p>
        </div>
        <div className="bg-muted/35 flex rounded-lg p-1">
          {(["all", "unread", "needs-you"] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setFilter(value)}
              className={cn(
                "text-muted-foreground h-7 rounded-md px-3 text-xs capitalize transition-colors",
                filter === value && "bg-background text-foreground shadow-sm",
              )}
            >
              {value.replace("-", " ")}
            </button>
          ))}
        </div>
      </header>

      <div className="bg-card min-h-0 flex-1 overflow-hidden">
        {filteredMessages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center px-6 text-center">
            <Inbox className="text-muted-foreground/60" size={22} />
            <h2 className="mt-4 text-sm font-medium">You’re caught up</h2>
            <p className="text-muted-foreground mt-1 max-w-sm text-xs leading-5">
              New replies, mentions, and work needing your attention will show
              up here.
            </p>
          </div>
        ) : (
          <div className="grid h-full min-h-0 grid-cols-[minmax(280px,360px)_1fr]">
            <div className="border-border/60 min-h-0 overflow-y-auto border-r">
              {filteredMessages.map((message) => {
                const channel = channelsById.get(message.channelId);
                const needsYou = needsUserMessageIds.has(message.id);
                return (
                  <button
                    key={message.id}
                    type="button"
                    onClick={() => setSelectedId(message.id)}
                    className={cn(
                      "border-border/50 hover:bg-muted/35 flex w-full gap-3 border-b px-4 py-3.5 text-left [content-visibility:auto]",
                      selected?.id === message.id && "bg-muted/45",
                    )}
                  >
                    <AgentAvatar
                      label={message.actor.name}
                      className="size-7 rounded-lg"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-xs font-medium">
                          {message.actor.name}
                        </span>
                        <span className="text-muted-foreground ml-auto shrink-0 text-[10px]">
                          {relativeTime(message.createdAt)}
                        </span>
                      </span>
                      <span className="text-foreground/80 mt-1 line-clamp-2 text-xs leading-5">
                        {messagePreviewText(message.content) ||
                          "Sent an attachment"}
                      </span>
                      <span className="text-muted-foreground mt-1.5 flex items-center gap-1.5 text-[10px]">
                        {channel?.visibility === "direct"
                          ? "Direct message"
                          : `#${channel?.name ?? "channel"}`}
                        {needsYou ? <AttentionPill className="ml-1" /> : null}
                      </span>
                    </span>
                    {message.unread ? (
                      <span className="mt-1 size-1.5 shrink-0 rounded-full bg-sky-500" />
                    ) : null}
                  </button>
                );
              })}
            </div>

            <section className="flex min-w-0 flex-col">
              {selected && selectedChannel ? (
                <>
                  <div className="border-border/60 flex items-center gap-3 border-b px-6 py-4">
                    <AgentAvatar
                      label={selected.actor.name}
                      className="rounded-lg"
                    />
                    <div className="min-w-0">
                      <h2 className="truncate text-sm font-medium">
                        {selected.actor.name}
                      </h2>
                      <p className="text-muted-foreground text-xs">
                        {selectedChannel.visibility === "direct"
                          ? "Direct message"
                          : `#${selectedChannel.name}`}
                      </p>
                    </div>
                    {needsUserMessageIds.has(selected.id) ? (
                      <AttentionPill className="ml-auto" />
                    ) : null}
                  </div>
                  <div className="min-h-0 flex-1 overflow-y-auto px-8 py-8">
                    <div className="max-w-2xl text-[15px] leading-7">
                      <StreamingMarkdown>
                        {selected.content || "Sent an attachment"}
                      </StreamingMarkdown>
                    </div>
                  </div>
                  <footer className="border-border/60 flex items-center justify-between border-t px-6 py-4">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={markSelectedRead}
                      disabled={!selected.unread}
                    >
                      <CheckCheck size={14} />
                      {selected.unread ? "Mark read" : "Read"}
                    </Button>
                    <Button size="sm" onClick={() => openMessage(selected)}>
                      <MessageSquare size={14} />
                      Open conversation
                      <ArrowUpRight size={13} />
                    </Button>
                  </footer>
                </>
              ) : null}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
