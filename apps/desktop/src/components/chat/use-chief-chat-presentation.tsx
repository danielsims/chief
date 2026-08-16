import { useCallback, useMemo } from "react";

import type {
  ChiefUIMessage,
  MessageAttachment,
} from "@chief/agent-runtime/types";

import type { WorkspaceAgentId } from "../../lib/workspace-channels";
import type { ThreadParticipant } from "./channel-message-controls";
import type { ChiefChatProps } from "./chief-chat-types";
import type { useChiefChatComposer } from "./use-chief-chat-composer";
import type { useChiefChatCore } from "./use-chief-chat-core";
import type { useChiefChatTimeline } from "./use-chief-chat-timeline";
import {
  actionItemsInConversation,
  actionItemsInThread,
  legacyThreadRootIdsNeedingUser,
  threadRootIdsNeedingUser,
} from "../../lib/channel-action-items";
import { withoutMarkerLines } from "../../lib/integration-setup";
import { messageBlocks } from "../../lib/runtime";
import { WORKSPACE_AGENT_IDENTITIES } from "../../lib/workspace-channels";
import {
  ChannelMessageActions,
  ChannelMessageMeta,
} from "./channel-message-controls";
import { conversationVisibleBlocks } from "./conversation-visible-blocks";
import { specialistNeedsUserInThread } from "./specialist-task-display";
import { summarizeThreadReplyCandidates } from "./thread-reply-summary";

type Core = ReturnType<typeof useChiefChatCore>;
type Composer = ReturnType<typeof useChiefChatComposer>;
type Timeline = ReturnType<typeof useChiefChatTimeline>;

/**
 * Adapts core messages and timeline data into render-ready conversation
 * details, including visible blocks, thread summaries, reactions, agent
 * attribution, attachments, and per-message controls. It owns no persistence.
 */
export function useChiefChatPresentation({
  channel,
  chatId,
  composer,
  core,
  directAgent,
  timeline,
}: Pick<ChiefChatProps, "channel" | "chatId" | "directAgent"> & {
  composer: Composer;
  core: Core;
  timeline: Timeline;
}) {
  const { channelReactions, messages, userAuthor } = core;
  const { setThreadRootId, threadRootId } = composer;
  const { activeSpecialistByThread, activeThreadReplies, threadReplies } =
    timeline;
  const openActionSourceIds = useMemo(
    () =>
      new Set(
        core.workspaceData.actionItems.flatMap((action) =>
          action.status === "open" && action.sourceId ? [action.sourceId] : [],
        ),
      ),
    [core.workspaceData.actionItems],
  );
  const openActionThreadRootIds = useMemo(() => {
    const exact = threadRootIdsNeedingUser({
      actionItems: core.workspaceData.actionItems,
      sessions: core.workspaceData.activity,
    });
    for (const rootId of legacyThreadRootIdsNeedingUser({
      actionItems: core.workspaceData.actionItems,
      chatId,
      messages,
    })) {
      exact.add(rootId);
    }
    return exact;
  }, [
    chatId,
    core.workspaceData.actionItems,
    core.workspaceData.activity,
    messages,
  ]);
  const visibleConversationBlocks = useCallback(
    (message: ChiefUIMessage) =>
      conversationVisibleBlocks(withoutMarkerLines(messageBlocks(message))),
    [],
  );
  const threadActions = useMemo(
    () =>
      threadRootId
        ? actionItemsInThread({
            actionItems: core.workspaceData.actionItems,
            chatId,
            messages,
            sessions: core.workspaceData.activity,
            threadRootId,
          })
        : [],
    [
      chatId,
      core.workspaceData.actionItems,
      core.workspaceData.activity,
      messages,
      threadRootId,
    ],
  );
  const conversationActions = useMemo(
    () =>
      actionItemsInConversation({
        actionItems: core.workspaceData.actionItems,
        chatId,
        sessions: core.workspaceData.activity,
      }),
    [chatId, core.workspaceData.actionItems, core.workspaceData.activity],
  );
  const summarizeThreadReplies = (replies: readonly ChiefUIMessage[]) => {
    const summary = summarizeThreadReplyCandidates(
      replies.map((reply) => ({
        role: reply.role,
        createdAt: reply.metadata?.createdAt,
        blocks: withoutMarkerLines(messageBlocks(reply)),
        visibleBlocks: visibleConversationBlocks(reply),
      })),
    );
    return {
      ...summary,
      visibleReplies: summary.visibleIndexes.flatMap((index) =>
        replies[index] ? [replies[index]] : [],
      ),
    };
  };
  const respondingAgentFor = (message: ChiefUIMessage) => {
    if (directAgent) return directAgent;
    const authoredId = message.metadata?.agentId;
    const respondingId = (
      authoredId && Object.hasOwn(WORKSPACE_AGENT_IDENTITIES, authoredId)
        ? authoredId
        : message.metadata?.mentions?.find((agentId) =>
            Object.hasOwn(WORKSPACE_AGENT_IDENTITIES, agentId),
          )
    ) as WorkspaceAgentId | undefined;
    const identity = respondingId
      ? WORKSPACE_AGENT_IDENTITIES[respondingId]
      : undefined;
    return respondingId && identity
      ? { id: respondingId, name: identity.name, role: identity.role }
      : undefined;
  };
  const controlsForMessage = (message: ChiefUIMessage) => {
    if (!channel) return {};
    const replySummary = summarizeThreadReplies(
      threadReplies.get(message.id) ?? [],
    );
    const text = messageBlocks(message)
      .flatMap((part) => (part.type === "text" ? [part.text] : []))
      .join("\n");
    const openThread = () => {
      setThreadRootId(message.id);
    };
    const toggleReaction = (emoji: string) =>
      channelReactions.toggleReaction(message.id, emoji);
    const specialist = activeSpecialistByThread.get(message.id);
    const participants = replySummary.visibleReplies.flatMap(
      (reply): ThreadParticipant[] => {
        if (reply.role === "user") {
          return [
            {
              id: "current-user",
              kind: "user",
              name: userAuthor.name,
              ...(userAuthor.image ? { image: userAuthor.image } : {}),
            },
          ];
        }
        if (reply.role !== "assistant") return [];
        const agent = respondingAgentFor(reply) ?? {
          id: "chief" as const,
          name: "Chief",
        };
        return [
          {
            id: `agent:${agent.id}`,
            kind: "agent",
            name: agent.name,
            agentId: agent.id,
          },
        ];
      },
    );
    return {
      actions: (
        <ChannelMessageActions
          text={text}
          onReply={openThread}
          onToggleReaction={toggleReaction}
        />
      ),
      footer: (
        <ChannelMessageMeta
          replies={replySummary.visibleReplies}
          replyCount={replySummary.count}
          lastReplyAt={replySummary.lastReplyAt}
          participants={participants}
          reactions={channelReactions.reactions.get(message.id) ?? []}
          specialist={specialist}
          needsUser={
            openActionThreadRootIds.has(message.id) ||
            (specialist
              ? specialistNeedsUserInThread(
                  specialist,
                  message.id,
                  openActionSourceIds,
                )
              : false)
          }
          onOpenThread={openThread}
          onToggleReaction={toggleReaction}
        />
      ),
    };
  };
  const imageParts = (message: ChiefUIMessage): MessageAttachment[] =>
    messageBlocks(message).flatMap((block) =>
      block.type === "image"
        ? [
            {
              name: block.name,
              mediaType: block.mediaType,
              url: block.url,
            },
          ]
        : [],
    );
  const activeThreadSummary = summarizeThreadReplies(activeThreadReplies);

  return {
    conversationActions,
    threadActions,
    activeThreadSummary,
    controlsForMessage,
    imageParts,
    respondingAgentFor,
    threadBlocks: visibleConversationBlocks,
    visibleConversationBlocks,
  };
}
