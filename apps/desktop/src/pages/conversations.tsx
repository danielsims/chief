/* eslint-disable max-lines */

import { startTransition, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";

import type { DriverType } from "@chief/agent-runtime/types";
import { defaultAgents } from "@chief/agent-runtime/agent-roster";
import { cn } from "@chief/ui/lib/utils";

import type { AgentPresence } from "../components/chat/agent-profile-panel";
import type { ConversationProfileSelection } from "../components/chat/conversation-profile";
import type { WorkspaceAgentId } from "../lib/workspace-channels";
import {
  AgentProfilePanel,
  UserProfilePanel,
} from "../components/chat/agent-profile-panel";
import { ChannelCanvas } from "../components/chat/channel-canvas";
import { ChiefChat } from "../components/chat/chief-chat";
import {
  clearComposerHandoff,
  composerHandoff,
} from "../components/chat/composer-handoff";
import { useConversationAuxiliaryPanelSizing } from "../components/chat/conversation-auxiliary-panel";
import { ConversationErrorBoundary } from "../components/chat/conversation-error-boundary";
import { ConversationHeader } from "../components/chat/conversation-header";
import { useAuth } from "../lib/auth/auth-context";
import { INTEGRATION_CATALOG } from "../lib/integration-catalog";
import {
  googleAnalyticsActionIdFromChat,
  integrationSetupChannelPath,
  integrationSetupDomainFromChat,
} from "../lib/integration-setup";
import {
  useLocalChats,
  useRuntime,
  useWorkspaceChannels,
  useWorkspaceData,
} from "../lib/runtime";
import {
  channelIdFromChatId,
  resolvedChannelChatId,
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
const DEFAULT_WORKSPACE_CHANNEL =
  WORKSPACE_CHANNELS.find((channel) => channel.id === "general") ??
  WORKSPACE_CHANNELS[0];

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
  const location = useLocation();
  const navigate = useNavigate();
  const handoffId = params.get("handoff");
  const initialHandoff = useMemo(() => composerHandoff(handoffId), [handoffId]);
  const panelSizing = useConversationAuxiliaryPanelSizing();
  const running = useRunningChats();
  const { agents: runtimeAgents, status: runtimeStatus } = useRuntime();
  const requestedChatId = params.get("chat");
  const requestedChannelId = channelIdFromChatId(requestedChatId);
  const staticRequestedChannel = workspaceChannel(params.get("channel"));
  const runtimeRequestedChannel = workspaceChannels.channels.find(
    (channel) =>
      channel.visibility !== "direct" &&
      (channel.id === params.get("channel") ||
        channel.slug === params.get("channel")),
  );
  const channelRequestedByChat = workspaceChannels.channels.find(
    (channel) =>
      channel.visibility !== "direct" && channel.id === requestedChannelId,
  );
  const resolvedRuntimeChannel =
    runtimeRequestedChannel ?? channelRequestedByChat;
  const staticChannelRequestedByChat = WORKSPACE_CHANNELS.find(
    (channel) => channel.relayId === requestedChannelId,
  );
  const requestedChannel = resolvedRuntimeChannel
    ? {
        id: resolvedRuntimeChannel.id,
        relayId: resolvedRuntimeChannel.id,
        label: resolvedRuntimeChannel.name,
        description: resolvedRuntimeChannel.description,
        agentIds: resolvedRuntimeChannel.agentIds,
      }
    : (staticRequestedChannel ?? staticChannelRequestedByChat);
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
      : DEFAULT_WORKSPACE_CHANNEL);
  const isDefaultChannelRoute =
    requestedChatId === null &&
    requestedDirectMessage === null &&
    params.get("channel") === null;
  const activeConversationChannel =
    requestedChannel ?? (isDefaultChannelRoute ? activeChannel : undefined);
  const navigationState =
    typeof location.state === "object" && location.state !== null
      ? (location.state as { focusComposerFor?: unknown })
      : null;
  const focusComposer =
    navigationState?.focusComposerFor === activeConversationChannel?.id;
  const activeChatId = activeConversationChannel
    ? resolvedChannelChatId(
        activeConversationChannel.id,
        cloudOrganizationId,
        localChats.chats,
      )
    : requestedDirectMessage
      ? resolvedChannelChatId(
          requestedDirectMessage.relayId,
          cloudOrganizationId,
          localChats.chats,
        )
      : requestedChatId;
  const activeChildId = params.get("child");
  const activeSetupActionId = googleAnalyticsActionIdFromChat(activeChatId);
  const activeSetupDomain =
    params.get("setup") ?? integrationSetupDomainFromChat(activeChatId);
  const legacySetupPath = (() => {
    if (!activeSetupDomain || !activeSetupActionId) return null;
    const integration = INTEGRATION_CATALOG.flatMap(
      (group) => group.integrations,
    ).find((candidate) => candidate.domain === activeSetupDomain);
    return integrationSetupChannelPath(
      {
        domain: activeSetupDomain,
        name: integration?.name ?? activeSetupDomain,
      },
      activeSetupActionId,
    );
  })();
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
  const activeProfileDirectMessage =
    workspaceDirectMessage(activeProfileAgentId);
  const activeProfileChatId = activeProfileDirectMessage
    ? resolvedChannelChatId(
        activeProfileDirectMessage.relayId,
        cloudOrganizationId,
        localChats.chats,
      )
    : null;
  const activeProfilePresence: AgentPresence = activeProfileAgentId
    ? activeProfileChatId && running[activeProfileChatId]
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
  const activityOpen = params.get("activity") === "1";
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
  const activeView =
    !directIdentity && params.get("view") === "canvas" ? "canvas" : "messages";

  useEffect(() => {
    if (!legacySetupPath) return;
    void navigate(legacySetupPath, { replace: true });
  }, [legacySetupPath, navigate]);

  useEffect(() => {
    if (!focusComposer) return;
    let clearFrame = 0;
    const focusFrame = window.requestAnimationFrame(() => {
      clearFrame = window.requestAnimationFrame(() => {
        void navigate(`${location.pathname}${location.search}`, {
          replace: true,
          state: null,
        });
      });
    });
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.cancelAnimationFrame(clearFrame);
    };
  }, [focusComposer, location.pathname, location.search, navigate]);
  const activeChild = workspaceData.activity.find(
    (session) =>
      session.id === activeChildId && session.parentId === activeChatId,
  );
  const hasAuxiliaryPanel = userProfileOpen || activeProfileAgent !== null;
  const openProfile = (selection: ConversationProfileSelection) => {
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.delete("activity");
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
  const setActivityPanel = (open: boolean) => {
    setParams((current) => {
      const next = new URLSearchParams(current);
      if (open) {
        next.delete("child");
        next.delete("profile");
        next.set("activity", "1");
      } else {
        next.delete("activity");
      }
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
  const setConversationView = (view: "messages" | "canvas") => {
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.delete("activity");
      next.delete("child");
      next.delete("profile");
      if (view === "canvas") next.set("view", "canvas");
      else next.delete("view");
      return next;
    });
  };
  const conversationHeader = (
    <ConversationHeader
      channel={activeChannel}
      directAgentId={requestedDirectMessage?.id ?? null}
      directIdentity={directIdentity}
      directPresence={directPresence}
      onContinueArtifact={continueArtifact}
      onOpenActivity={() => setActivityPanel(true)}
      onOpenProfile={openProfile}
      activeView={activeView}
      onViewChange={setConversationView}
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
          {activeChatId && activeView === "canvas" && !directIdentity ? (
            <>
              {conversationHeader}
              <ChannelCanvas
                channelName={activeChannel.label}
                onContinueArtifact={continueArtifact}
              />
            </>
          ) : activeChatId ? (
            <ConversationErrorBoundary resetKey={activeChatId}>
              <ChiefChat
                key={`${activeChatId}:${params.get("thread") ?? ""}:${params.get("message") ?? ""}`}
                chatId={activeChatId}
                initialMessageId={params.get("message") ?? undefined}
                initialThreadRootId={params.get("thread") ?? undefined}
                isNew={isNew}
                channel={activeConversationChannel}
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
                  requestedDirectMessage?.relayId ??
                  activeConversationChannel?.relayId
                }
                integrationDomain={activeSetupDomain ?? undefined}
                activeChild={activeChild}
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
                initialPrompt={
                  initialHandoff?.text ?? params.get("prompt") ?? undefined
                }
                initialAttachments={initialHandoff?.attachments}
                initialDraft={params.get("draft") ?? undefined}
                focusComposer={focusComposer}
                onInitialPromptSent={() => {
                  clearComposerHandoff(handoffId);
                  setParams(
                    (current) => {
                      const next = new URLSearchParams(current);
                      next.delete("handoff");
                      next.delete("prompt");
                      next.delete("driver");
                      next.delete("model");
                      return next;
                    },
                    { replace: true },
                  );
                }}
                onCloseChild={() =>
                  setParams((current) => {
                    const next = new URLSearchParams(current);
                    next.delete("child");
                    return next;
                  })
                }
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
                activityOpen={activityOpen}
                onActivityOpenChange={setActivityPanel}
                onOpenProfile={openProfile}
                panelSizing={panelSizing}
                profileOpen={userProfileOpen || activeProfileAgent !== null}
                header={conversationHeader}
              />
            </ConversationErrorBoundary>
          ) : null}
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
      ) : null}
    </main>
  );
}
