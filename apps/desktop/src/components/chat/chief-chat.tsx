import { useMemo, useRef } from "react";
import { ArrowDown } from "lucide-react";

import type { BrowserRunRecord } from "@chief/agent-runtime/types";

import type { ChiefChatProps } from "./chief-chat-types";
import { messageBlocks } from "../../lib/runtime";
import { InputRequestSection } from "../integrations/input-request-section";
import { TimelineActionRequestCard } from "./action-request-card";
import { AgentActivityComposerRow } from "./agent-activity-composer-row";
import { ApprovalCard } from "./approval-card";
import { approvalBelongsToSurface } from "./approval-presentation";
import { BrowserSessionAttachment } from "./browser-panel";
import { ChatComposer } from "./chat-composer";
import { ChatErrorStatus } from "./chat-error-status";
import { ChatTimeline } from "./chat-timeline";
import { ChiefChatAuxiliaryPanels } from "./chief-chat-auxiliary-panels";
import {
  ChannelMembershipMessage,
  ChatSkeleton,
  ChiefMessage,
  ConversationEmptyState,
  MessageBlocksContent,
} from "./chief-chat-message-components";
import { withActionTimelineEntries } from "./conversation-timeline-entries";
import { QuestionCard } from "./question-card";
import { RecurringWorkComposer } from "./recurring-work-composer";
import { useChiefChatComposer } from "./use-chief-chat-composer";
import { useChiefChatCore } from "./use-chief-chat-core";
import { useChiefChatPresentation } from "./use-chief-chat-presentation";
import { useChiefChatTimeline } from "./use-chief-chat-timeline";
import { useMainAgentActivity } from "./use-main-agent-activity";
import { UserMessage } from "./user-message";

export function ChiefChat({
  chatId,
  isNew,
  composer,
  composerDate,
  composerPlaybookId,
  initialPrompt,
  initialAttachments = [],
  initialDraft,
  initialMessageId,
  initialThreadRootId,
  focusComposer = false,
  initialDriver,
  initialModel,
  channel,
  directAgent,
  destinationChannelId,
  integrationDomain,
  activeChild,
  onInitialPromptSent,
  onCloseChild,
  onOpenChild,
  channelReferences = [],
  onOpenChannel,
  onThreadRootChange,
  onOpenProfile,
  activityOpen,
  onActivityOpenChange,
  panelSizing,
  profileOpen = false,
  header,
}: ChiefChatProps) {
  const pictureInPictureContainerRef = useRef<HTMLDivElement>(null);
  const pictureInPictureComposerRef = useRef<HTMLDivElement>(null);
  const pictureInPictureAvoidRefs = useMemo(
    () => [pictureInPictureComposerRef],
    [],
  );
  const core = useChiefChatCore({
    channel,
    chatId,
    destinationChannelId,
    directAgent,
    initialDriver,
    initialModel,
    integrationDomain,
    onActivityOpenChange,
  });
  const composerState = useChiefChatComposer({
    core,
    props: {
      chatId,
      composer,
      initialAttachments,
      initialDraft,
      initialMessageId,
      initialPrompt,
      initialThreadRootId,
      isNew,
      onInitialPromptSent,
      onOpenProfile,
      onThreadRootChange,
    },
  });
  const {
    activeCapabilities,
    activeExecution,
    activityAgentLabel,
    activeRootTurn,
    anchorBrowserSession,
    browserRuns,
    browserSessions,
    channelResolved,
    chatReady,
    childSessions,
    cloudOrganizationId,
    controls,
    dismissError,
    currentUser,
    interrupt,
    knownAgentIds,
    markThreadRead,
    mentionCandidates,
    messages,
    pendingInput,
    provideInput,
    respondPermission,
    respondQuestion,
    setActivityOpen,
    setAnsweredInputs,
    setSelectedExecution,
    setVisibleThread,
    statusLabel,
    userAuthor,
  } = core;
  const {
    bottomRef,
    composeSchedule,
    composerOpen,
    draft,
    imageAttachments,
    mainScrolledUp,
    mainScrollRef,
    openAgentMention,
    openUserProfile,
    optimisticInitialPrompt,
    selectProfile,
    setComposerOpen,
    setDraft,
    setImageAttachments,
    setThreadRootId,
    submit,
    suppressThreadAutoScrollRef,
    threadHasEnteredRef,
    threadRootId,
    threadScrollRef,
  } = composerState;
  const timelineState = useChiefChatTimeline({
    activeChild,
    anchorBrowserSession,
    browserRuns,
    browserSessions,
    channel,
    chatId,
    childSessions,
    cloudOrganizationId,
    controlsStatus: controls.status,
    destinationChannelId,
    initialMessageId,
    knownAgentIds,
    markThreadRead,
    messages,
    optimisticInitialPrompt,
    setVisibleThread,
    suppressThreadAutoScrollRef,
    threadHasEnteredRef,
    threadRootId,
    threadScrollRef,
  });
  const {
    activeMainChildSessions,
    childSessionOwners,
    showOptimisticInitialPrompt,
    timelineEntries,
  } = timelineState;
  const { agents: mainActivityAgents, statusLabel: mainStatusLabel } =
    useMainAgentActivity({
      activeRootTurn,
      channelAgentIds: channel?.agentIds,
      directAgentId: directAgent?.id,
      running: controls.status === "running",
      statusLabel,
      tasks: activeMainChildSessions,
    });
  const browserAttachmentNode = (run: BrowserRunRecord) => (
    <div className="mx-auto w-full max-w-3xl py-1 pl-11">
      <BrowserSessionAttachment
        operating={controls.status === "running"}
        pictureInPictureAvoidRefs={pictureInPictureAvoidRefs}
        pictureInPictureContainerRef={pictureInPictureContainerRef}
        run={run}
      />
    </div>
  );
  const {
    conversationActions,
    threadActions,
    activeThreadSummary,
    controlsForMessage,
    imageParts,
    respondingAgentFor,
    threadBlocks,
    visibleConversationBlocks,
  } = useChiefChatPresentation({
    channel,
    chatId,
    composer: composerState,
    core,
    directAgent,
    timeline: timelineState,
  });
  const conversationTimelineEntries = useMemo(
    () => withActionTimelineEntries(timelineEntries, conversationActions),
    [conversationActions, timelineEntries],
  );
  return (
    <>
      {controls.error && !controls.errorAcknowledged ? (
        <ChatErrorStatus
          key={controls.error}
          onOpen={() => {
            dismissError();
            setActivityOpen(true);
          }}
        />
      ) : null}
      <div className="relative flex h-full min-w-0 overflow-hidden">
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {header}
          <div
            ref={pictureInPictureContainerRef}
            className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden px-5 pb-3"
          >
            <div
              ref={mainScrollRef}
              data-chat-timeline
              className="min-w-0 flex-1 space-y-3 overflow-x-hidden overflow-y-auto py-6 pr-2"
            >
              {composerOpen && messages.length === 0 ? (
                <div className="mx-auto flex h-full w-full max-w-3xl items-center justify-center py-6">
                  <RecurringWorkComposer
                    mode={composer === "oneoff" ? "one-off" : "recurring"}
                    date={composerDate}
                    playbookId={composerPlaybookId}
                    onCompose={composeSchedule}
                    onSubmit={submit}
                    onDismiss={() => setComposerOpen(false)}
                  />
                </div>
              ) : null}
              {!channelResolved && !isNew && !composerOpen ? (
                <ChatSkeleton />
              ) : null}
              {(chatReady || isNew) &&
              !composerOpen &&
              messages.length === 0 &&
              !showOptimisticInitialPrompt ? (
                <ConversationEmptyState
                  channel={channel}
                  directAgent={directAgent}
                />
              ) : null}
              {showOptimisticInitialPrompt && optimisticInitialPrompt ? (
                <UserMessage
                  text={optimisticInitialPrompt}
                  author={userAuthor}
                  metadata={channel ? null : undefined}
                  channelReferences={channelReferences}
                  onOpenChannel={onOpenChannel}
                  onOpenProfile={openUserProfile}
                  onOpenMention={openAgentMention}
                />
              ) : null}
              {channelResolved || isNew ? (
                <ChatTimeline
                  entries={conversationTimelineEntries}
                  renderEntry={(entry) => {
                    if (entry.type === "browser") {
                      return browserAttachmentNode(entry.run);
                    }
                    if (entry.type === "action") {
                      return (
                        <TimelineActionRequestCard
                          action={entry.action}
                          currentUser={currentUser}
                          resolve={core.workspaceData.resolveActionRequest}
                        />
                      );
                    }
                    if (entry.type === "specialist") return null;
                    const { message } = entry;
                    if (message.metadata?.channelAction) {
                      return (
                        <ChannelMembershipMessage
                          action={message.metadata.channelAction}
                          timestamp={message.metadata.createdAt}
                          userImage={userAuthor.image}
                        />
                      );
                    }
                    if (message.role === "user") {
                      if (message.id === `${chatId}-kickoff`) return null;
                      return (
                        <div id={`chief-message-${message.id}`}>
                          <UserMessage
                            author={userAuthor}
                            attachments={imageParts(message)}
                            metadata={channel ? null : undefined}
                            channelReferences={channelReferences}
                            onOpenChannel={onOpenChannel}
                            onOpenProfile={openUserProfile}
                            onOpenMention={openAgentMention}
                            timestamp={message.metadata?.createdAt}
                            {...controlsForMessage(message)}
                            text={messageBlocks(message)
                              .flatMap((part) =>
                                part.type === "text" ? [part.text] : [],
                              )
                              .join("\n")}
                          />
                        </div>
                      );
                    }
                    if (message.role !== "assistant") return null;
                    const timelineBlocks = visibleConversationBlocks(message);
                    if (timelineBlocks.length === 0) return null;
                    const timelineFilter = visibleConversationBlocks;
                    return (
                      <ChiefMessage
                        messageId={message.id}
                        agent={respondingAgentFor(message)}
                        metadata={channel ? null : undefined}
                        onOpenProfile={selectProfile}
                        timestamp={message.metadata?.createdAt}
                        {...controlsForMessage(message)}
                      >
                        <MessageBlocksContent
                          message={message}
                          filter={timelineFilter}
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
              ) : null}
              {controls.approvals
                .filter((approval) => approvalBelongsToSurface(approval, null))
                .map((approval) => (
                  <div key={approval.requestId} className="mx-auto max-w-3xl">
                    <ApprovalCard
                      approval={approval}
                      onRespond={respondPermission}
                    />
                  </div>
                ))}
              {!threadRootId
                ? controls.questions.map((pending) => (
                    <div key={pending.requestId} className="mx-auto max-w-3xl">
                      <QuestionCard
                        pending={pending}
                        onSubmit={(answers) =>
                          respondQuestion(pending.requestId, answers)
                        }
                        onDismiss={() =>
                          respondQuestion(pending.requestId, null)
                        }
                      />
                    </div>
                  ))
                : null}
              {pendingInput ? (
                <div className="mx-auto max-w-3xl">
                  <InputRequestSection
                    request={pendingInput}
                    onSubmit={(request, values) => {
                      provideInput(request, values);
                      setAnsweredInputs((s) => new Set(s).add(request.id));
                    }}
                  />
                </div>
              ) : null}
              <div ref={bottomRef} />
            </div>

            <div
              ref={pictureInPictureComposerRef}
              className="relative mx-auto w-full max-w-3xl"
            >
              {mainScrolledUp && channelResolved ? (
                <button
                  type="button"
                  aria-label="Scroll to latest"
                  onClick={() =>
                    mainScrollRef.current?.scrollTo({
                      top: mainScrollRef.current.scrollHeight,
                      behavior: "smooth",
                    })
                  }
                  className="bg-background text-muted-foreground hover:text-foreground focus-visible:ring-ring/30 absolute -top-12 left-1/2 z-20 flex size-10 -translate-x-1/2 items-center justify-center rounded-full border shadow-lg transition-colors outline-none focus-visible:ring-2"
                >
                  <ArrowDown size={16} />
                </button>
              ) : null}
              <div className="relative space-y-2">
                {composerOpen && messages.length > 0 ? (
                  <RecurringWorkComposer
                    mode={composer === "oneoff" ? "one-off" : "recurring"}
                    date={composerDate}
                    playbookId={composerPlaybookId}
                    onCompose={composeSchedule}
                    onSubmit={submit}
                    onDismiss={() => setComposerOpen(false)}
                  />
                ) : null}
                <ChatComposer
                  autoFocus={focusComposer}
                  value={draft}
                  onValueChange={setDraft}
                  onSubmit={submit}
                  imageAttachments={imageAttachments}
                  onImageAttachmentsChange={setImageAttachments}
                  execution={activeExecution}
                  onExecutionChange={setSelectedExecution}
                  running={controls.status === "running"}
                  onInterrupt={interrupt}
                  showSuggestions={false}
                  showExecutionControls={!channel && !directAgent}
                  mentionCandidates={channel ? mentionCandidates : []}
                  placeholder={
                    directAgent
                      ? `Message ${directAgent.name}…`
                      : channel
                        ? `Message #${channel.label}…`
                        : undefined
                  }
                />
                <AgentActivityComposerRow
                  agents={mainActivityAgents}
                  agentLabel={activityAgentLabel}
                  running={mainActivityAgents.length > 0}
                  statusLabel={mainStatusLabel}
                  onOpen={() => {
                    const onlyAgent = mainActivityAgents[0];
                    if (
                      mainActivityAgents.length === 1 &&
                      onlyAgent?.taskId &&
                      onOpenChild
                    ) {
                      onOpenChild(onlyAgent.taskId);
                      return;
                    }
                    setThreadRootId(null);
                    setActivityOpen(true);
                  }}
                />
              </div>
            </div>
          </div>
        </div>
        <ChiefChatAuxiliaryPanels
          threadActions={threadActions}
          activeThreadSummary={activeThreadSummary}
          composer={composerState}
          core={core}
          imageParts={imageParts}
          props={{
            activeChild,
            activityOpen,
            channel,
            channelReferences,
            onOpenChannel,
            onCloseChild,
            onOpenChild,
            panelSizing,
            profileOpen,
          }}
          respondingAgentFor={respondingAgentFor}
          threadBlocks={threadBlocks}
          timeline={timelineState}
        />
      </div>
    </>
  );
}
