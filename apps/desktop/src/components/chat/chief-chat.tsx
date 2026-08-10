import { Fragment } from "react";
import { ArrowDown } from "lucide-react";

import type { BrowserRunRecord } from "@chief/agent-runtime/types";

import type { ChiefChatProps } from "./chief-chat-types";
import { messageBlocks } from "../../lib/runtime";
import { InputRequestSection } from "../integrations/input-request-section";
import { AgentActivityComposerRow } from "./agent-activity-composer-row";
import { ApprovalCard } from "./approval-card";
import { approvalBelongsToSurface } from "./approval-presentation";
import { BrowserSessionAttachment } from "./browser-panel";
import { ChatComposer } from "./chat-composer";
import { ChiefChatAuxiliaryPanels } from "./chief-chat-auxiliary-panels";
/**
 * Memoized per-message content. Thread rows are referentially stable after the
 * runtime merge, so unchanged messages skip re-rendering entirely instead of
 * rebuilding the whole thread on every stream/tool event — that rebuild is what
 * made opening a thread (especially one with a browser) janky and flickery.
 * progress is intentionally excluded: it only feeds tool cards, which no longer
 * render in the chat.
 */
import {
  ChannelMembershipMessage,
  ChatSkeleton,
  ChiefMessage,
  MessageBlocksContent,
} from "./chief-chat-message-components";
import { SpecialistTaskCard } from "./message-blocks";
import { QuestionCard } from "./question-card";
import { RecurringWorkComposer } from "./recurring-work-composer";
import { useChiefChatComposer } from "./use-chief-chat-composer";
import { useChiefChatCore } from "./use-chief-chat-core";
import { useChiefChatPresentation } from "./use-chief-chat-presentation";
import { useChiefChatTimeline } from "./use-chief-chat-timeline";
import { UserMessage } from "./user-message";

/**
 * Composes the core, composer, timeline, and presentation hooks into the full
 * Chief conversation surface, including its main feed and auxiliary panels.
 */
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
  onOpenProfile,
  onOpenInternalPanel,
  activityOpen,
  onActivityOpenChange,
  panelSizing,
  profileOpen = false,
  header,
}: ChiefChatProps) {
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
    },
  });
  const {
    activeCapabilities,
    activeExecution,
    activityAgentLabel,
    anchorBrowserSession,
    browserRuns,
    browserSessions,
    channelResolved,
    chatReady,
    childSessions,
    cloudOrganizationId,
    controls,
    interrupt,
    knownAgentIds,
    markThreadRead,
    mentionCandidates,
    messages,
    pendingInput,
    provideInput,
    respondPermission,
    respondQuestion,
    runtimeStatus,
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
  const { childSessionOwners, showOptimisticInitialPrompt, timelineEntries } =
    timelineState;
  const browserAttachmentNode = (run: BrowserRunRecord) => (
    <div className="mx-auto w-full max-w-3xl py-1 pl-11">
      <BrowserSessionAttachment
        operating={controls.status === "running"}
        run={run}
      />
    </div>
  );
  const {
    acknowledgedDmMessageId,
    activeThreadSummary,
    controlsForMessage,
    imageParts,
    respondingAgentFor,
    threadBlocks,
    visibleConversationBlocks,
  } = useChiefChatPresentation({
    channel,
    composer: composerState,
    core,
    directAgent,
    onOpenInternalPanel,
    timeline: timelineState,
  });

  return (
    <div className="relative flex h-full min-w-0 overflow-hidden">
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {header}
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden px-5 pb-3">
          <div
            ref={mainScrollRef}
            className="min-w-0 flex-1 space-y-3 overflow-x-hidden overflow-y-auto py-6 pr-2"
          >
            {/* A new chat has nothing to replay, so its identity header renders
            immediately; existing chats wait for history so the empty state
            never flashes before the transcript. */}
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
              <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
                <p className="text-2xl font-medium tracking-[-0.03em]">
                  {channel
                    ? `#${channel.label}`
                    : (directAgent?.name ?? "Chief")}
                </p>
                <p className="text-muted-foreground max-w-md text-sm">
                  {channel
                    ? channel.description
                    : directAgent
                      ? `A private conversation with ${directAgent.name}.`
                      : "Your CMO. Ask anything, and Chief will bring in the right specialist."}
                </p>
                {channel ? (
                  <p className="text-muted-foreground/75 text-xs">
                    {channel.agentIds.length} agents share this channel’s
                    context.
                  </p>
                ) : null}
                {runtimeStatus !== "connected" && (
                  <p className="text-muted-foreground mt-4 border border-dashed px-3 py-2 text-xs">
                    Agent runtime not connected. Run <code>pnpm dev</code> in
                    the repo root.
                  </p>
                )}
              </div>
            ) : null}
            {showOptimisticInitialPrompt && optimisticInitialPrompt ? (
              <UserMessage
                text={optimisticInitialPrompt}
                author={userAuthor}
                acknowledgedBy={
                  controls.status === "running" && !channel
                    ? (directAgent?.name ?? "Chief")
                    : undefined
                }
                metadata={channel ? null : undefined}
                onOpenProfile={openUserProfile}
                onOpenMention={openAgentMention}
              />
            ) : null}
            {channelResolved || isNew
              ? timelineEntries.map((entry) => {
                  if (entry.type === "browser") {
                    return (
                      <Fragment key={entry.key}>
                        {browserAttachmentNode(entry.run)}
                      </Fragment>
                    );
                  }
                  if (entry.type === "specialist") {
                    return (
                      <div
                        key={entry.task.id}
                        className="mx-auto w-full max-w-3xl pl-11"
                      >
                        <SpecialistTaskCard
                          task={entry.task}
                          onOpenTask={onOpenChild}
                        />
                      </div>
                    );
                  }
                  const { message } = entry;
                  if (channel && message.metadata?.threadRootId) return null;
                  if (message.metadata?.channelAction) {
                    return (
                      <ChannelMembershipMessage
                        key={message.id}
                        action={message.metadata.channelAction}
                        userImage={userAuthor.image}
                      />
                    );
                  }
                  if (message.role === "user") {
                    if (message.id === `${chatId}-kickoff`) return null;
                    return (
                      <div id={`chief-message-${message.id}`} key={message.id}>
                        <UserMessage
                          author={userAuthor}
                          acknowledgedBy={
                            message.id === acknowledgedDmMessageId
                              ? (directAgent?.name ?? "Chief")
                              : undefined
                          }
                          attachments={imageParts(message)}
                          metadata={channel ? null : undefined}
                          onOpenProfile={openUserProfile}
                          onOpenMention={openAgentMention}
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
                      key={message.id}
                      messageId={message.id}
                      agent={respondingAgentFor(message)}
                      metadata={channel ? null : undefined}
                      onOpenProfile={selectProfile}
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
                        onOpenTask={onOpenChild}
                      />
                    </ChiefMessage>
                  );
                })
              : null}
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
                      onDismiss={() => respondQuestion(pending.requestId, null)}
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
            {controls.error && (
              <p className="border-destructive/40 text-destructive mx-auto max-w-3xl rounded-xl border px-3 py-2 text-xs">
                {controls.error}
              </p>
            )}
            <div ref={bottomRef} />
          </div>

          <div className="relative mx-auto w-full max-w-3xl">
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
                agentLabel={activityAgentLabel}
                running={controls.status === "running"}
                statusLabel={statusLabel}
                onOpen={() => {
                  setThreadRootId(null);
                  setActivityOpen(true);
                  onOpenInternalPanel?.();
                }}
              />
            </div>
          </div>
        </div>
      </div>
      <ChiefChatAuxiliaryPanels
        activeThreadSummary={activeThreadSummary}
        browserAttachmentNode={browserAttachmentNode}
        composer={composerState}
        core={core}
        imageParts={imageParts}
        props={{
          activeChild,
          activityOpen,
          channel,
          onCloseChild,
          onOpenChild,
          onOpenInternalPanel,
          panelSizing,
          profileOpen,
        }}
        respondingAgentFor={respondingAgentFor}
        threadBlocks={threadBlocks}
        timeline={timelineState}
      />
    </div>
  );
}
