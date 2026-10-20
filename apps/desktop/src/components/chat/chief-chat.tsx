import { useMemo, useRef } from "react";
import { ArrowDown } from "lucide-react";

import type { BrowserRunRecord } from "@chief/agent-runtime/types";
import { cn } from "@chief/ui/lib/utils";

import type { ThreadAgent } from "./chief-chat-auxiliary-panels";
import type { ChiefChatProps } from "./chief-chat-types";
import { messageBlocks } from "../../lib/runtime";
import { useChannelTyping } from "../../lib/use-channel-typing";
import { workspaceCardClassName } from "../workspace-content-surface";
import { AgentActivityComposerRow } from "./agent-activity-composer-row";
import { BrowserSessionAttachment } from "./browser-panel";
import { ChatComposer } from "./chat-composer";
import { ChatTimeline } from "./chat-timeline";
import { ChiefChatAuxiliaryPanels } from "./chief-chat-auxiliary-panels";
import {
  ChannelMembershipMessage,
  ChatSkeleton,
  ChiefMessage,
  ConversationEmptyState,
  MessageBlocksContent,
} from "./chief-chat-message-components";
import { continuedMessageIds } from "./conversation-timeline-entries";
import { ChannelGuestMentions } from "./mention-people-context";
import { PeopleTypingRow } from "./people-typing-row";
import { QuestionAnswersProvider } from "./question-answers-context";
import { RecurringWorkComposer } from "./recurring-work-composer";
import { ScheduledRunMessage } from "./scheduled-run-message";
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
  const { names: typingNames, notifyTyping } =
    useChannelTyping(destinationChannelId);
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
    agentsLoaded,
    anchorBrowserSession,
    browserRuns,
    browserSessions,
    channelResolved,
    childSessions,
    cloudOrganizationId,
    controls,
    currentUser,
    interrupt,
    knownAgentIds,
    markThreadRead,
    mentionCandidates,
    messages,
    setActivityOpen,
    setSelectedExecution,
    setVisibleThread,
    statusLabel,
    userAuthor,
    authorFor,
  } = core;
  const {
    bottomRef,
    composeSchedule,
    composerOpen,
    draft,
    imageAttachments,
    mainContentRef,
    mainScrolledUp,
    mainScrollRef,
    openAgentMention,
    openUserProfile,
    openAuthorProfile,
    optimisticInitialPrompt,
    selectProfile,
    setComposerOpen,
    setDraft,
    setImageAttachments,
    scrollMainToBottom,
    setThreadRootId,
    submit,
    threadRootId,
  } = composerState;
  const timelineState = useChiefChatTimeline({
    activeChild,
    anchorBrowserSession,
    browserRuns,
    browserSessions,
    chatId,
    childSessions,
    cloudOrganizationId,
    controlsStatus: controls.status,
    destinationChannelId,
    knownAgentIds,
    markThreadRead,
    messages,
    optimisticInitialPrompt,
    setVisibleThread,
    threadRootId,
  });
  const {
    activeMainChildSessions,
    childSessionOwners,
    showOptimisticInitialPrompt,
    timelineEntries,
  } = timelineState;
  // In an agent DM, every top-level message is answered in its own thread.
  // The thread opens as the usual auxiliary panel, so no separate surface.
  const threadAgent: ThreadAgent | undefined = directAgent
    ? { name: directAgent.name }
    : undefined;
  const { agents: mainActivityAgents, statusLabel: mainStatusLabel } =
    useMainAgentActivity({
      activeRootTurn,
      channelAgentIds: channel?.agentIds,
      directAgentId: directAgent?.id,
      running: controls.status === "running",
      statusLabel,
      tasks: activeMainChildSessions,
      scheduleRuns: core.scheduleRuns,
      workingAgents: controls.workingAgents,
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
    destinationChannelId,
    directAgent,
    timeline: timelineState,
  });
  // Messages wait for the agent roster, so authors never appear as Chief and
  // then change. A message you just sent still shows straight away.
  const timelineReady =
    agentsLoaded && (channelResolved || isNew === true || messages.length > 0);
  const continuedIds = useMemo(
    () => continuedMessageIds(timelineEntries, currentUser?.id),
    [timelineEntries, currentUser?.id],
  );
  return (
    <ChannelGuestMentions guests={core.channelGuests}>
      <QuestionAnswersProvider messages={messages} send={core.send}>
        <div className="relative flex h-full min-w-0 min-[901px]:gap-2">
          <div
            className={cn(
              workspaceCardClassName,
              "flex min-w-0 flex-1 flex-col",
            )}
          >
            {header}
            <div
              ref={pictureInPictureContainerRef}
              className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden px-5 pb-3"
            >
              <div
                ref={mainScrollRef}
                data-chat-timeline
                className="min-w-0 flex-1 overflow-x-hidden overflow-y-auto py-6 pr-2"
              >
                <div
                  ref={mainContentRef}
                  className="flex min-h-full flex-col space-y-3"
                >
                  {composerOpen && messages.length === 0 ? (
                    <div className="mx-auto flex w-full max-w-3xl flex-1 items-center justify-center py-6">
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
                  {!timelineReady &&
                  !composerOpen &&
                  !showOptimisticInitialPrompt ? (
                    <ChatSkeleton />
                  ) : null}
                  {channelResolved &&
                  agentsLoaded &&
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
                      channelReferences={channelReferences}
                      onOpenChannel={onOpenChannel}
                      onOpenProfile={openUserProfile}
                      onOpenMention={openAgentMention}
                    />
                  ) : null}
                  {timelineReady ? (
                    <ChatTimeline
                      entries={timelineEntries}
                      renderEntry={(entry) => {
                        if (entry.type === "browser") {
                          return browserAttachmentNode(entry.run);
                        }
                        if (entry.type === "specialist") return null;
                        const { message } = entry;
                        if (message.metadata?.scheduledRun)
                          return (
                            <div className="mx-auto w-full max-w-3xl py-2 pl-11">
                              <ScheduledRunMessage
                                run={message.metadata.scheduledRun}
                                progress={core.scheduleRuns.find(
                                  (run) =>
                                    run.id ===
                                    message.metadata?.scheduledRun?.runId,
                                )}
                                onOpen={() => setThreadRootId(message.id)}
                              />
                              {controlsForMessage(message).footer}
                            </div>
                          );
                        if (message.metadata?.channelAction) {
                          return (
                            <ChannelMembershipMessage
                              action={message.metadata.channelAction}
                              currentUserId={currentUser?.id}
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
                                continued={continuedIds.has(message.id)}
                                author={authorFor(message)}
                                {...(message.metadata?.guest
                                  ? { guest: message.metadata.guest }
                                  : undefined)}
                                attachments={imageParts(message)}
                                channelReferences={channelReferences}
                                onOpenChannel={onOpenChannel}
                                {...(message.metadata?.guest
                                  ? undefined
                                  : {
                                      onOpenProfile: openAuthorProfile(message),
                                    })}
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
                        const timelineBlocks =
                          visibleConversationBlocks(message);
                        if (timelineBlocks.length === 0) return null;
                        const timelineFilter = visibleConversationBlocks;
                        return (
                          <ChiefMessage
                            messageId={message.id}
                            agent={respondingAgentFor(message)}
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
                  <div ref={bottomRef} />
                </div>
              </div>
              <div
                ref={pictureInPictureComposerRef}
                className="relative mx-auto w-full max-w-3xl"
              >
                {mainScrolledUp && channelResolved ? (
                  <button
                    type="button"
                    aria-label="Scroll to latest"
                    onClick={() => void scrollMainToBottom("smooth")}
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
                    storageKey={`${cloudOrganizationId}:${chatId}`}
                    value={draft}
                    onValueChange={(value) => {
                      setDraft(value);
                      notifyTyping(value);
                    }}
                    onSubmit={() => {
                      notifyTyping("");
                      submit();
                    }}
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
                  {mainActivityAgents.length === 0 && typingNames.length > 0 ? (
                    <PeopleTypingRow names={typingNames} />
                  ) : (
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
                  )}
                </div>
              </div>
            </div>
          </div>
          <ChiefChatAuxiliaryPanels
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
            threadAgent={threadAgent}
            threadBlocks={threadBlocks}
            timeline={timelineState}
          />
        </div>
      </QuestionAnswersProvider>
    </ChannelGuestMentions>
  );
}
