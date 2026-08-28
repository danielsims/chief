import { Fragment, useMemo, useRef } from "react";

import type {
  ActionItem,
  BrowserRunRecord,
  ChiefUIMessage,
  ContentBlock,
  MessageAttachment,
} from "@chief/agent-runtime/types";

import type { WorkspaceAgentId } from "../../lib/workspace-channels";
import type { ChiefChatProps } from "./chief-chat-types";
import type { useChiefChatComposer } from "./use-chief-chat-composer";
import type { useChiefChatCore } from "./use-chief-chat-core";
import type { useChiefChatTimeline } from "./use-chief-chat-timeline";
import { messageBlocks } from "../../lib/runtime";
import {
  isWorkspaceAgentId,
  WORKSPACE_AGENT_IDENTITIES,
} from "../../lib/workspace-channels";
import { TimelineActionRequestCard } from "./action-request-card";
import { AgentActivityComposerRow } from "./agent-activity-composer-row";
import { AgentActivityPanel } from "./agent-activity-panel";
import {
  formatAgentActivityStatus,
  mergeAgentActivityPresence,
  taskAgentActivityPresence,
} from "./agent-activity-presence";
import { ApprovalCard } from "./approval-card";
import { approvalBelongsToSurface } from "./approval-presentation";
import { BrowserSessionAttachment } from "./browser-panel";
import { ChatComposer } from "./chat-composer";
import { ChatDateSeparator } from "./chat-date-time";
import { ChatTimeline } from "./chat-timeline";
import {
  ChiefMessage,
  MessageBlocksContent,
} from "./chief-chat-message-components";
import {
  ConversationAuxiliaryBreadcrumb,
  ConversationAuxiliaryPanel,
  ConversationAuxiliaryPanelBody,
  ConversationAuxiliaryPanelHeader,
} from "./conversation-auxiliary-panel";
import {
  withActionTimelineEntries,
  withSpecialistTimelineEntries,
} from "./conversation-timeline-entries";
import { ObservedChat } from "./observed-chat";
import { QuestionCard } from "./question-card";
import {
  taskActivitySubtitle,
  ThreadSpecialistTaskCard,
} from "./specialist-task-card";
import { UserMessage } from "./user-message";

type Core = ReturnType<typeof useChiefChatCore>;
type Composer = ReturnType<typeof useChiefChatComposer>;
type Timeline = ReturnType<typeof useChiefChatTimeline>;

function activityAgentName(agentId: string) {
  return isWorkspaceAgentId(agentId)
    ? WORKSPACE_AGENT_IDENTITIES[agentId].name
    : agentId;
}

interface ThreadSummary {
  count: number;
  lastReplyAt?: number;
  visibleReplies: ChiefUIMessage[];
}

/**
 * Renders the conversation's mutually exclusive secondary surfaces, including
 * threads, agent activity, specialist work, and profiles, beside the main feed.
 */
export function ChiefChatAuxiliaryPanels({
  threadActions,
  activeThreadSummary,
  composer,
  core,
  imageParts,
  props,
  respondingAgentFor,
  threadBlocks,
  timeline,
}: {
  threadActions: readonly ActionItem[];
  activeThreadSummary: ThreadSummary;
  composer: Composer;
  core: Core;
  imageParts: (message: ChiefUIMessage) => MessageAttachment[];
  props: Pick<
    ChiefChatProps,
    | "activeChild"
    | "activityOpen"
    | "channel"
    | "channelReferences"
    | "onOpenChannel"
    | "onCloseChild"
    | "onOpenChild"
    | "panelSizing"
    | "profileOpen"
  >;
  respondingAgentFor: (
    message: ChiefUIMessage,
  ) => { id: WorkspaceAgentId; name: string; role: string } | undefined;
  threadBlocks: (message: ChiefUIMessage) => ContentBlock[];
  timeline: Timeline;
}) {
  const {
    activeChild,
    activityOpen,
    channel,
    channelReferences = [],
    onOpenChannel,
    onCloseChild,
    onOpenChild,
    panelSizing,
    profileOpen = false,
  } = props;
  const {
    activeCapabilities,
    activityAgentLabel,
    activeRootTurn,
    childSessions,
    controls,
    currentTurnBlocks,
    interrupt,
    mentionCandidates,
    previousActivityTurns,
    respondPermission,
    respondQuestion,
    send,
    setActivityOpen,
    statusLabel,
    userAuthor,
  } = core;
  const {
    openAgentMention,
    openUserProfile,
    selectProfile,
    setThreadDraft,
    setThreadImageAttachments,
    setThreadRootId,
    threadBottomRef,
    threadDraft,
    threadImageAttachments,
    threadRootId,
    threadScrollRef,
  } = composer;
  const {
    activeSpecialistByThread,
    activeChildThreadRootId,
    activeThreadAudience,
    activeThreadChildSessions,
    activeThreadRoot,
    browserOperating,
    browserRunAnchors,
    chatBrowserRuns,
    childSessionOwners,
    threadReplyEntries,
  } = timeline;
  const threadTimelineEntries = useMemo(
    () =>
      withActionTimelineEntries(
        withSpecialistTimelineEntries(
          threadReplyEntries,
          activeThreadChildSessions,
        ),
        threadActions,
      ),
    [activeThreadChildSessions, threadActions, threadReplyEntries],
  );
  const threadPictureInPictureContainerRef = useRef<HTMLDivElement>(null);
  const threadComposerRef = useRef<HTMLDivElement>(null);
  const threadPictureInPictureAvoidRefs = useMemo(
    () => [threadComposerRef],
    [],
  );
  const threadActivityAgents = useMemo(() => {
    const root =
      controls.status === "running" &&
      activeRootTurn?.threadRootId === threadRootId
        ? {
            id: activeRootTurn.agentId,
            label: activityAgentName(activeRootTurn.agentId),
          }
        : undefined;
    return mergeAgentActivityPresence(
      root,
      taskAgentActivityPresence(activeThreadChildSessions, activityAgentName),
    );
  }, [
    activeRootTurn,
    activeThreadChildSessions,
    controls.status,
    threadRootId,
  ]);
  const threadStatusLabel =
    threadActivityAgents.length === 1 &&
    threadActivityAgents[0]?.id === activeRootTurn?.agentId
      ? statusLabel
      : formatAgentActivityStatus(threadActivityAgents);
  const threadBrowserAttachmentNode = (run: BrowserRunRecord) => (
    <div className="w-full min-w-0 py-1 pl-11">
      <BrowserSessionAttachment
        operating={browserOperating}
        pictureInPictureAvoidRefs={threadPictureInPictureAvoidRefs}
        pictureInPictureContainerRef={threadPictureInPictureContainerRef}
        run={run}
      />
    </div>
  );
  const closeAuxiliaryWorkspace = () => {
    setActivityOpen(false);
    onCloseChild?.();
  };
  const returnToThread = () => {
    if (!activeChildThreadRootId) return;
    setActivityOpen(false);
    onCloseChild?.(activeChildThreadRootId);
  };
  const returnFromChild = () => {
    setActivityOpen(false);
    onCloseChild?.(activeChildThreadRootId ?? undefined);
  };
  if (activeChild && !profileOpen) {
    return (
      <ConversationAuxiliaryPanel
        onClose={closeAuxiliaryWorkspace}
        sizing={panelSizing}
      >
        <ConversationAuxiliaryPanelHeader
          backLabel={
            activeChildThreadRootId
              ? "Back to thread"
              : activityOpen
                ? "Back to activity"
                : "Back to conversation"
          }
          onBack={returnFromChild}
          title={
            <ConversationAuxiliaryBreadcrumb
              current="Activity"
              items={
                activeChildThreadRootId
                  ? [
                      {
                        key: "thread",
                        label: "Thread",
                        onClick: returnToThread,
                      },
                    ]
                  : []
              }
            />
          }
          subtitle={taskActivitySubtitle(activeChild)}
          onClose={closeAuxiliaryWorkspace}
        />
        <ConversationAuxiliaryPanelBody className="overflow-hidden">
          <ObservedChat
            key={activeChild.id}
            chatId={activeChild.id}
            showHeader={false}
            activityOnly
          />
        </ConversationAuxiliaryPanelBody>
      </ConversationAuxiliaryPanel>
    );
  }

  if (channel && threadRootId && !activityOpen && !profileOpen) {
    return (
      <ConversationAuxiliaryPanel
        onClose={() => setThreadRootId(null)}
        sizing={panelSizing}
      >
        <ConversationAuxiliaryPanelHeader
          title={
            <ConversationAuxiliaryBreadcrumb current="Thread" items={[]} />
          }
          subtitle={`${activeThreadSummary.count} ${activeThreadSummary.count === 1 ? "reply" : "replies"}`}
          onClose={() => setThreadRootId(null)}
        />
        <div
          ref={threadPictureInPictureContainerRef}
          className="relative flex min-h-0 flex-1 flex-col overflow-hidden"
        >
          <ConversationAuxiliaryPanelBody
            ref={threadScrollRef}
            data-chat-timeline
            className="space-y-2 overflow-x-hidden px-4 py-4"
          >
            <ChatDateSeparator
              timestamp={activeThreadRoot?.metadata?.createdAt}
            />
            {activeThreadRoot?.role === "user" ? (
              <div id={`chief-message-${activeThreadRoot.id}`}>
                <UserMessage
                  author={userAuthor}
                  attachments={imageParts(activeThreadRoot)}
                  metadata={null}
                  channelReferences={channelReferences}
                  onOpenChannel={onOpenChannel}
                  onOpenProfile={openUserProfile}
                  onOpenMention={openAgentMention}
                  text={messageText(activeThreadRoot)}
                  timestamp={activeThreadRoot.metadata?.createdAt}
                />
              </div>
            ) : null}
            {chatBrowserRuns.map((run) =>
              run.threadRootId === threadRootId &&
              browserRunAnchors.get(run.id) === activeThreadRoot?.id ? (
                <Fragment key={`browser:root:${run.id}`}>
                  {threadBrowserAttachmentNode(run)}
                </Fragment>
              ) : null,
            )}
            <ChatTimeline
              entries={threadTimelineEntries}
              initialTimestamp={activeThreadRoot?.metadata?.createdAt}
              renderEntry={(entry) => {
                if (entry.type === "browser") {
                  return threadBrowserAttachmentNode(entry.run);
                }
                if (entry.type === "action") {
                  return (
                    <TimelineActionRequestCard
                      action={entry.action}
                      currentUser={core.currentUser}
                      resolve={core.workspaceData.resolveActionRequest}
                    />
                  );
                }
                if (entry.type === "specialist") {
                  return (
                    <ThreadSpecialistTaskCard
                      task={entry.task}
                      onOpenTask={onOpenChild}
                    />
                  );
                }
                const { message } = entry;
                if (message.role === "user") {
                  return (
                    <div id={`chief-message-${message.id}`}>
                      <UserMessage
                        author={userAuthor}
                        attachments={imageParts(message)}
                        metadata={null}
                        channelReferences={channelReferences}
                        onOpenChannel={onOpenChannel}
                        onOpenProfile={openUserProfile}
                        onOpenMention={openAgentMention}
                        text={messageText(message)}
                        timestamp={message.metadata?.createdAt}
                      />
                    </div>
                  );
                }
                if (threadBlocks(message).length === 0) return null;
                const respondingAgent = respondingAgentFor(message);
                const specialist = threadRootId
                  ? activeSpecialistByThread.get(threadRootId)
                  : undefined;
                return (
                  <ChiefMessage
                    messageId={message.id}
                    activity={
                      specialist && respondingAgent?.id === specialist.agent
                        ? specialist
                        : undefined
                    }
                    agent={respondingAgent}
                    metadata={null}
                    onOpenProfile={selectProfile}
                    timestamp={message.metadata?.createdAt}
                  >
                    <MessageBlocksContent
                      message={message}
                      filter={threadBlocks}
                      progress={controls.toolProgress}
                      capabilities={activeCapabilities}
                      active={controls.status === "running"}
                      tasks={childSessions}
                      taskOwners={childSessionOwners}
                      ownerId={message.id}
                      channelReferences={channelReferences}
                      onOpenChannel={onOpenChannel}
                      onOpenTask={onOpenChild}
                    />
                  </ChiefMessage>
                );
              }}
            />
            {controls.questions.map((pending) => (
              <div key={pending.requestId} className="mx-auto max-w-3xl">
                <QuestionCard
                  pending={pending}
                  onSubmit={(answers) =>
                    respondQuestion(pending.requestId, answers)
                  }
                  onDismiss={() => respondQuestion(pending.requestId, null)}
                />
              </div>
            ))}
            {controls.approvals
              .filter((approval) =>
                approvalBelongsToSurface(approval, threadRootId),
              )
              .map((approval) => (
                <div key={approval.requestId} className="w-full">
                  <ApprovalCard
                    approval={approval}
                    onRespond={respondPermission}
                  />
                </div>
              ))}
            <div ref={threadBottomRef} />
          </ConversationAuxiliaryPanelBody>
          <div ref={threadComposerRef} className="relative shrink-0 px-3 pb-3">
            <div className="relative space-y-2">
              <ChatComposer
                value={threadDraft}
                onValueChange={setThreadDraft}
                imageAttachments={threadImageAttachments}
                onImageAttachmentsChange={setThreadImageAttachments}
                onSubmit={() => {
                  const text = threadDraft.trim();
                  if (!text && threadImageAttachments.length === 0) return;
                  setThreadDraft("");
                  setThreadImageAttachments([]);
                  send(
                    text,
                    threadRootId,
                    activeThreadAudience,
                    threadImageAttachments,
                    controls.status === "running",
                  );
                }}
                running={controls.status === "running"}
                onInterrupt={interrupt}
                showSuggestions={false}
                showExecutionControls={false}
                mentionCandidates={mentionCandidates}
                placeholder={`Reply in #${channel.label}…`}
              />
              <AgentActivityComposerRow
                agents={threadActivityAgents}
                agentLabel={activityAgentLabel}
                running={threadActivityAgents.length > 0}
                statusLabel={threadStatusLabel}
                onOpen={() => {
                  const onlyAgent = threadActivityAgents[0];
                  if (
                    threadActivityAgents.length === 1 &&
                    onlyAgent?.taskId &&
                    onOpenChild
                  ) {
                    onOpenChild(onlyAgent.taskId);
                    return;
                  }
                  setActivityOpen(true);
                }}
              />
            </div>
          </div>
        </div>
      </ConversationAuxiliaryPanel>
    );
  }

  return activityOpen && !profileOpen && !activeChild ? (
    <AgentActivityPanel
      blocks={currentTurnBlocks}
      error={controls.error}
      previousTurns={previousActivityTurns}
      running={controls.status === "running"}
      tasks={childSessions}
      onClose={() => setActivityOpen(false)}
      onOpenTask={onOpenChild}
      sizing={panelSizing}
    />
  ) : null;
}

const messageText = (message: ChiefUIMessage) =>
  messageBlocks(message)
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("\n");
