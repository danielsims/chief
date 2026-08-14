import { useEffect, useMemo, useRef, useState } from "react";

import type {
  ChatExecutionSelection,
  MessageAttachment,
} from "@chief/agent-runtime/types";

import type { ChiefChatProps } from "./chief-chat-types";
import { useAgentConfig } from "../../lib/agent-config";
import { useAuth } from "../../lib/auth/auth-context";
import { useChannelReadState } from "../../lib/channel-read-state-context";
import {
  findPendingInputRequest,
  withoutMarkerLines,
} from "../../lib/integration-setup";
import {
  messageBlocks,
  useChannelReactions,
  useChiefChat,
  useRuntime,
  useWorkspaceData,
} from "../../lib/runtime";
import { WORKSPACE_AGENT_IDENTITIES } from "../../lib/workspace-channels";
import { channelActivityState } from "./channel-activity-state";
import { channelRecipients } from "./channel-thread-audience";
import { conversationActivityTurns } from "./conversation-activity-history";
import { orderMentionCandidatesByMembership } from "./mention-candidate-order";

/**
 * Connects a Chief conversation to runtime, authentication, workspace, and
 * channel services. It owns execution selection, message routing, mentions,
 * pending input, and activity state, but no composer or rendering concerns.
 */
export function useChiefChatCore({
  channel,
  chatId,
  destinationChannelId,
  directAgent,
  initialDriver,
  initialModel,
  integrationDomain,
  onActivityOpenChange,
}: Pick<
  ChiefChatProps,
  | "channel"
  | "chatId"
  | "destinationChannelId"
  | "directAgent"
  | "initialDriver"
  | "initialModel"
  | "integrationDomain"
  | "onActivityOpenChange"
>) {
  const {
    status: runtimeStatus,
    anchorBrowserSession,
    browserRuns,
    browserSessions,
  } = useRuntime();
  const { cloudOrganizationId, user } = useAuth();
  const { markThreadRead, setVisibleThread } = useChannelReadState();
  const userAuthor = {
    name: user?.name.trim() ?? "You",
    ...(user?.image ? { image: user.image } : {}),
  };
  const currentUser = user
    ? { id: user.id, ...(user.image ? { image: user.image } : {}) }
    : null;
  const workspaceData = useWorkspaceData(cloudOrganizationId);
  const channelReactions = useChannelReactions(
    channel ? (destinationChannelId ?? null) : null,
  );
  const childSessions = workspaceData.activity
    .filter(
      (session) =>
        (session.parentId === chatId ||
          session.triggerContext?.originConversationId === chatId) &&
        session.kind === "task" &&
        session.visibility === "private" &&
        !session.scheduleId,
    )
    .sort((a, b) => a.createdAt - b.createdAt);
  const resolved = useAgentConfig().forAgent(directAgent?.id ?? "chief");
  const initialExecution = resolved.driver
    ? { driver: resolved.driver, model: resolved.model }
    : initialDriver
      ? { driver: initialDriver, model: initialModel }
      : undefined;
  const [selectedExecution, setSelectedExecution] =
    useState<ChatExecutionSelection | null>(null);
  const chat = useChiefChat(
    chatId,
    initialExecution,
    selectedExecution ?? undefined,
    destinationChannelId === workspaceData.waysOfWorking.missionControlChannelId
      ? "full"
      : resolved.access,
    {
      channelId: destinationChannelId,
      agentId: directAgent?.id,
      wakeOnMentionOnly: Boolean(channel),
      conversationSurface: channel ? "channel" : "direct",
      integrationDomain,
    },
  );
  const [activeRootTurn, setActiveRootTurn] = useState<{
    agentId: string;
    threadRootId?: string;
  } | null>(null);
  const wasRunningRef = useRef(false);
  useEffect(() => {
    if (chat.controls.status === "running") {
      wasRunningRef.current = true;
      return;
    }
    if (wasRunningRef.current) {
      wasRunningRef.current = false;
      setActiveRootTurn(null);
    }
  }, [chat.controls.status]);
  const resumedThreadRootId = useMemo(() => {
    if (chat.controls.status !== "running" || activeRootTurn) return undefined;
    for (let index = chat.messages.length - 1; index >= 0; index -= 1) {
      const message = chat.messages[index];
      if (message?.role === "user") return message.metadata?.threadRootId;
    }
    return undefined;
  }, [activeRootTurn, chat.controls.status, chat.messages]);
  const visibleActiveRootTurn =
    activeRootTurn ??
    (chat.controls.status === "running" && chat.sessionAgentId
      ? {
          agentId: chat.sessionAgentId,
          ...(resumedThreadRootId ? { threadRootId: resumedThreadRootId } : {}),
        }
      : null);
  const activeRootIdentity =
    visibleActiveRootTurn &&
    Object.hasOwn(WORKSPACE_AGENT_IDENTITIES, visibleActiveRootTurn.agentId)
      ? WORKSPACE_AGENT_IDENTITIES[
          visibleActiveRootTurn.agentId as keyof typeof WORKSPACE_AGENT_IDENTITIES
        ]
      : undefined;
  const activityAgentLabel =
    activeRootIdentity?.name ?? directAgent?.name ?? "Chief";
  const currentTurn = useMemo(
    () =>
      channelActivityState(
        chat.messages,
        chat.controls.hasAgentOutput,
        activityAgentLabel,
      ),
    [activityAgentLabel, chat.controls.hasAgentOutput, chat.messages],
  );
  const activityTurns = useMemo(
    () =>
      conversationActivityTurns(
        chat.messages.flatMap((message) =>
          message.role === "assistant" || message.role === "user"
            ? [
                {
                  id: message.id,
                  role: message.role,
                  createdAt: message.metadata?.createdAt,
                  blocks: withoutMarkerLines(messageBlocks(message)),
                },
              ]
            : [],
        ),
      ),
    [chat.messages],
  );
  const currentActivityTurnId = activityTurns.at(-1)?.id;
  const previousActivityTurns = useMemo(
    () =>
      activityTurns
        .filter(
          (turn) =>
            turn.id !== currentActivityTurnId &&
            turn.blocks.some((block) => block.type === "tool_use"),
        )
        .reverse(),
    [activityTurns, currentActivityTurnId],
  );
  const activeExecution =
    selectedExecution ?? chat.execution ?? initialExecution;
  const [answeredInputs, setAnsweredInputs] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const pendingInput = useMemo(
    () => findPendingInputRequest(chat.messages, answeredInputs),
    [answeredInputs, chat.messages],
  );
  const [addedAgentIds, setAddedAgentIds] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const mentionCandidates = useMemo(
    () =>
      orderMentionCandidatesByMembership(
        Object.entries(WORKSPACE_AGENT_IDENTITIES)
          .filter(
            ([id]) =>
              id !== "setup" ||
              directAgent?.id === "setup" ||
              Boolean(channel?.agentIds.includes("setup")),
          )
          .map(([id, identity]) => ({
            id,
            ...identity,
            member:
              directAgent?.id === id ||
              addedAgentIds.has(id) ||
              Boolean(channel?.agentIds.includes(id)),
          })),
      ),
    [addedAgentIds, channel?.agentIds, directAgent?.id],
  );
  const knownAgentIds = useMemo(
    () => new Set(mentionCandidates.map((candidate) => candidate.id)),
    [mentionCandidates],
  );
  const send = (
    text: string,
    threadRootId?: string,
    inheritedThreadAudience: readonly string[] = [],
    attachments: readonly MessageAttachment[] = [],
    interruptActive = false,
  ) => {
    const normalizedText = text.toLocaleLowerCase();
    const mentionedAgentIds = mentionCandidates
      .map((candidate) => ({
        id: candidate.id,
        position: normalizedText.indexOf(
          `@${candidate.name.toLocaleLowerCase()}`,
        ),
      }))
      .filter((mention) => mention.position >= 0)
      .sort((left, right) => left.position - right.position)
      .map((mention) => mention.id);
    const mentions = channelRecipients(
      mentionedAgentIds,
      inheritedThreadAudience,
      knownAgentIds,
    );
    if (channel && mentions.length > 0) {
      setAddedAgentIds((current) => new Set([...current, ...mentions]));
    }
    const routedAgentId = channel
      ? (mentions[0] ??
        (destinationChannelId ===
        workspaceData.waysOfWorking.missionControlChannelId
          ? "chief"
          : channel.visibility === "private"
            ? channel.agentIds.find((agentId) => agentId !== "chief")
            : undefined))
      : (directAgent?.id ?? "chief");
    setActiveRootTurn(
      routedAgentId
        ? {
            agentId: routedAgentId,
            ...(threadRootId ? { threadRootId } : {}),
          }
        : null,
    );
    chat.sendMessageWithContext(
      text,
      { threadRootId, mentions, interruptActive },
      [...attachments],
    );
  };

  return {
    ...chat,
    activeCapabilities: resolved.capabilities,
    activeExecution,
    activityAgentLabel,
    activeRootTurn: visibleActiveRootTurn,
    anchorBrowserSession,
    browserRuns,
    browserSessions,
    channelReactions,
    childSessions,
    cloudOrganizationId,
    currentUser,
    currentTurnBlocks: currentTurn.blocks,
    driver: activeExecution?.driver,
    knownAgentIds,
    markThreadRead,
    mentionCandidates,
    pendingInput,
    previousActivityTurns,
    runtimeStatus,
    selectedExecution,
    send,
    setActivityOpen: onActivityOpenChange,
    setAnsweredInputs,
    setSelectedExecution,
    setVisibleThread,
    statusLabel: currentTurn.statusLabel,
    userAuthor,
    workspaceData,
  };
}
