import { startTransition, useEffect, useState } from "react";
import { Hash, PanelRightClose } from "lucide-react";
import { useSearchParams } from "react-router";

import type { DriverType } from "@chief/agent-runtime/types";
import { defaultAgents } from "@chief/agent-runtime/agent-roster";
import { Button } from "@chief/ui/components/button";
import { cn } from "@chief/ui/lib/utils";

import type { AgentPresence } from "../components/chat/agent-profile-panel";
import type { ConversationProfileSelection } from "../components/chat/conversation-profile";
import type { WorkspaceAgentId } from "../lib/workspace-channels";
import {
  AgentProfilePanel,
  UserProfilePanel,
} from "../components/chat/agent-profile-panel";
import { ChiefChat } from "../components/chat/chief-chat";
import {
  ConversationAuxiliaryPanel,
  useConversationAuxiliaryPanelSizing,
} from "../components/chat/conversation-auxiliary-panel";
import { ConversationHeader } from "../components/chat/conversation-header";
import { IntegrationSetupConversation } from "../components/chat/integration-setup-conversation";
import { ObservedChat } from "../components/chat/observed-chat";
import { useAuth } from "../lib/auth/auth-context";
import {
  googleAnalyticsActionIdFromChat,
  integrationSetupDomainFromChat,
} from "../lib/integration-setup";
import {
  useLocalChats,
  useRuntime,
  useWorkspaceChannels,
  useWorkspaceData,
} from "../lib/runtime";
import {
  channelChatId,
  directMessageChatId,
  WORKSPACE_AGENT_IDENTITIES,
  WORKSPACE_CHANNELS,
  workspaceChannel,
  workspaceDirectMessage,
} from "../lib/workspace-channels";

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

function isWorkspaceAgentId(value: string | null): value is WorkspaceAgentId {
  return value !== null && Object.hasOwn(WORKSPACE_AGENT_IDENTITIES, value);
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
  const workspaceChannels = useWorkspaceChannels();
  const workspaceData = useWorkspaceData(cloudOrganizationId);
  const [params, setParams] = useSearchParams();
  const panelSizing = useConversationAuxiliaryPanelSizing();
  const running = useRunningChats();
  const { agents: runtimeAgents, status: runtimeStatus } = useRuntime();
  const staticRequestedChannel = workspaceChannel(params.get("channel"));
  const runtimeRequestedChannel = workspaceChannels.channels.find(
    (channel) =>
      channel.visibility !== "direct" &&
      (channel.id === params.get("channel") ||
        channel.slug === params.get("channel")),
  );
  const requestedChannel = runtimeRequestedChannel
    ? {
        id: runtimeRequestedChannel.id,
        relayId: runtimeRequestedChannel.id,
        label: runtimeRequestedChannel.name,
        description: runtimeRequestedChannel.description,
        agentIds: runtimeRequestedChannel.agentIds,
      }
    : staticRequestedChannel;
  const requestedDirectMessage = workspaceDirectMessage(params.get("dm"));
  const directIdentity = requestedDirectMessage
    ? WORKSPACE_AGENT_IDENTITIES[requestedDirectMessage.id]
    : null;
  const defaultRuntimeChannel = workspaceChannels.channels.find(
    (channel) => channel.slug === "general",
  );
  const activeChannel =
    requestedChannel ??
    (defaultRuntimeChannel
      ? {
          id: defaultRuntimeChannel.id,
          relayId: defaultRuntimeChannel.id,
          label: defaultRuntimeChannel.name,
          description: defaultRuntimeChannel.description,
          agentIds: defaultRuntimeChannel.agentIds,
        }
      : WORKSPACE_CHANNELS[3]);
  const activeChatId =
    params.get("chat") ??
    (requestedChannel
      ? channelChatId(requestedChannel.id)
      : requestedDirectMessage
        ? directMessageChatId(requestedDirectMessage.id)
        : null);
  const activeChildId = params.get("child");
  const activeSetupActionId = googleAnalyticsActionIdFromChat(activeChatId);
  const activeSetupDomain = integrationSetupDomainFromChat(activeChatId);
  const activeEntry = localChats.chats.find(
    (entry) => entry.id === activeChatId,
  );
  const directPresence: AgentPresence =
    activeChatId && (running[activeChatId] ?? activeEntry?.running ?? false)
      ? "working"
      : runtimeStatus === "connected"
        ? "online"
        : "offline";
  const profileParam = params.get("profile");
  const activeProfileAgentId =
    profileParam === "agent" && requestedDirectMessage
      ? requestedDirectMessage.id
      : isWorkspaceAgentId(profileParam)
        ? profileParam
        : null;
  const activeProfileAgent = activeProfileAgentId
    ? (runtimeAgents.find((agent) => agent.id === activeProfileAgentId) ??
      defaultAgents.find((agent) => agent.id === activeProfileAgentId) ??
      null)
    : null;
  const activeProfileIdentity = activeProfileAgentId
    ? WORKSPACE_AGENT_IDENTITIES[activeProfileAgentId]
    : null;
  const activeProfilePresence: AgentPresence = activeProfileAgentId
    ? running[directMessageChatId(activeProfileAgentId)]
      ? "working"
      : runtimeStatus === "connected"
        ? "online"
        : "offline"
    : "offline";
  const activeProfileChannels = activeProfileAgent
    ? workspaceChannels.channels
        .filter(
          (channel) =>
            channel.visibility !== "direct" &&
            channel.agentIds.includes(activeProfileAgent.id),
        )
        .map((channel) => ({
          id: channel.id,
          name: channel.name,
          description: channel.description,
        }))
    : [];
  const userProfileOpen = profileParam === "user" && user !== null;
  const userProfileChannels = userProfileOpen
    ? workspaceChannels.channels
        .filter((channel) => channel.visibility !== "direct")
        .map((channel) => ({
          id: channel.id,
          name: channel.name,
          description: channel.description,
        }))
    : [];
  const isNew = Boolean(activeChatId && !localChats.loading && !activeEntry);
  const activeChild = workspaceData.activity.find(
    (session) =>
      session.id === activeChildId && session.parentId === activeChatId,
  );
  const hasAuxiliaryPanel =
    userProfileOpen || activeProfileAgent !== null || activeChild !== undefined;
  const openProfile = (selection: ConversationProfileSelection) => {
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.delete("child");
      next.set(
        "profile",
        selection.kind === "user" ? "user" : selection.agentId,
      );
      return next;
    });
  };
  const closeProfile = () => {
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.delete("profile");
      return next;
    });
  };
  const openInternalPanel = () => {
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.delete("child");
      next.delete("profile");
      return next;
    });
  };
  const continueArtifact = (artifact: { id: string; title: string }) => {
    startTransition(() =>
      setParams({
        channel: activeChannel.id,
        prompt: `Open the output “${artifact.title}” (${artifact.id}) and help me improve it.`,
      }),
    );
  };
  const conversationHeader = (
    <ConversationHeader
      channel={activeChannel}
      directAgentId={requestedDirectMessage?.id ?? null}
      directIdentity={directIdentity}
      directPresence={directPresence}
      onContinueArtifact={continueArtifact}
      onOpenProfile={openProfile}
      user={user}
    />
  );

  return (
    <main className="bg-background relative flex h-full min-w-0 flex-col overflow-hidden min-[901px]:flex-row">
      <section
        className={cn(
          "flex min-h-0 min-w-0 flex-1 flex-col",
          hasAuxiliaryPanel && "min-[901px]:min-w-[300px]",
        )}
      >
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {activeChatId && activeSetupDomain ? (
            <>
              {conversationHeader}
              <div className="min-h-0 flex-1 px-5 pb-5">
                <IntegrationSetupConversation
                  key={activeChatId}
                  chatId={activeChatId}
                  domain={activeSetupDomain}
                  actionId={activeSetupActionId ?? undefined}
                  channelId={requestedDirectMessage?.relayId}
                />
              </div>
            </>
          ) : activeChatId ? (
            <ChiefChat
              key={activeChatId}
              chatId={activeChatId}
              isNew={isNew}
              channel={requestedChannel ?? undefined}
              directAgent={
                directIdentity && requestedDirectMessage
                  ? {
                      id: requestedDirectMessage.id,
                      name: directIdentity.name,
                      role: directIdentity.role,
                    }
                  : undefined
              }
              destinationChannelId={
                requestedDirectMessage?.relayId ?? requestedChannel?.relayId
              }
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
                  next.delete("profile");
                  next.set("child", childId);
                  return next;
                })
              }
              onOpenInternalPanel={openInternalPanel}
              onOpenProfile={openProfile}
              panelSizing={panelSizing}
              profileOpen={userProfileOpen || activeProfileAgent !== null}
              header={conversationHeader}
            />
          ) : (
            <>
              {conversationHeader}
              <div className="text-muted-foreground flex min-h-0 flex-1 flex-col items-center justify-center gap-3 text-center text-sm">
                <span className="border-border bg-card flex size-10 items-center justify-center rounded-xl border">
                  <Hash size={18} />
                </span>
                <p className="font-serif text-3xl text-current">
                  #{activeChannel.label}
                </p>
                <p>{activeChannel.description}</p>
              </div>
            </>
          )}
        </div>
      </section>
      {activeChatId && userProfileOpen ? (
        <UserProfilePanel
          user={user}
          channels={userProfileChannels}
          onClose={closeProfile}
          sizing={panelSizing}
        />
      ) : activeChatId && activeProfileAgent ? (
        <AgentProfilePanel
          key={activeProfileAgent.id}
          agent={activeProfileAgent}
          channels={activeProfileChannels}
          displayName={activeProfileIdentity?.name}
          presence={activeProfilePresence}
          onClose={closeProfile}
          sizing={panelSizing}
        />
      ) : activeChatId && activeChild ? (
        <ConversationAuxiliaryPanel
          sizing={panelSizing}
          onClose={() =>
            setParams((current) => {
              const next = new URLSearchParams(current);
              next.delete("child");
              return next;
            })
          }
        >
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
        </ConversationAuxiliaryPanel>
      ) : null}
    </main>
  );
}
