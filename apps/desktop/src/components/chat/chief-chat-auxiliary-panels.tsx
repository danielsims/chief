import { Fragment, useMemo, useRef } from "react";

import type {
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
import { WORKSPACE_AGENT_IDENTITIES } from "../../lib/workspace-channels";
import { AgentActivityComposerRow } from "./agent-activity-composer-row";
import { AgentActivityPanel, taskAgentLabel } from "./agent-activity-panel";
import { ApprovalCard } from "./approval-card";
import { approvalBelongsToSurface } from "./approval-presentation";
import { BrowserSessionAttachment } from "./browser-panel";
import { ChatComposer } from "./chat-composer";
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
import { SpecialistTaskCard } from "./message-blocks";
import { ObservedChat } from "./observed-chat";
import { QuestionCard } from "./question-card";
import { UserMessage } from "./user-message";

type Core = ReturnType<typeof useChiefChatCore>;
type Composer = ReturnType<typeof useChiefChatComposer>;
type Timeline = ReturnType<typeof useChiefChatTimeline>;

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
  activeThreadSummary,
  composer,
  core,
  imageParts,
  props,
  respondingAgentFor,
  threadBlocks,
  timeline,
}: {
  activeThreadSummary: ThreadSummary;
  composer: Composer;
  core: Core;
  imageParts: (message: ChiefUIMessage) => MessageAttachment[];
  props: Pick<
    ChiefChatProps,
    | "activeChild"
    | "activityOpen"
    | "channel"
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
    onCloseChild,
    onOpenChild,
    panelSizing,
    profileOpen = false,
  } = props;
  const {
    activeCapabilities,
    activityAgentLabel,
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
    activeThreadRoot,
    browserOperating,
    browserRunAnchors,
    chatBrowserRuns,
    childBrowserRun,
    childSessionOwners,
    threadReplyEntries,
  } = timeline;
  const childPictureInPictureContainerRef = useRef<HTMLDivElement>(null);
  const threadPictureInPictureContainerRef = useRef<HTMLDivElement>(null);
  const threadComposerRef = useRef<HTMLDivElement>(null);
  const threadPictureInPictureAvoidRefs = useMemo(
    () => [threadComposerRef],
    [],
  );
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
              current={activeChild.title}
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
          subtitle={`${taskAgentLabel(activeChild.agent)} · ${taskStatusLabel(activeChild.status)}`}
          onClose={closeAuxiliaryWorkspace}
        />
        <ConversationAuxiliaryPanelBody
          ref={childPictureInPictureContainerRef}
          className="overflow-hidden"
        >
          <ObservedChat
            key={activeChild.id}
            chatId={activeChild.id}
            showHeader={false}
            inlineAttachment={
              childBrowserRun ? (
                <BrowserSessionAttachment
                  operating={browserOperating}
                  pictureInPictureContainerRef={
                    childPictureInPictureContainerRef
                  }
                  run={childBrowserRun}
                />
              ) : undefined
            }
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
            className="space-y-2 px-4 py-4"
          >
            {activeThreadRoot?.role === "user" ? (
              <div id={`chief-message-${activeThreadRoot.id}`}>
                <UserMessage
                  author={userAuthor}
                  attachments={imageParts(activeThreadRoot)}
                  metadata={null}
                  onOpenProfile={openUserProfile}
                  onOpenMention={openAgentMention}
                  text={messageText(activeThreadRoot)}
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
            <ThreadDivider count={activeThreadSummary.count} />
            {threadReplyEntries.map((entry) => {
              if (entry.type === "browser") {
                return (
                  <Fragment key={entry.key}>
                    {threadBrowserAttachmentNode(entry.run)}
                  </Fragment>
                );
              }
              if (entry.type === "specialist") {
                const agentId = entry.task.agent as WorkspaceAgentId;
                const identity = WORKSPACE_AGENT_IDENTITIES[agentId];
                return (
                  <ChiefMessage
                    key={entry.task.id}
                    agent={{
                      id: agentId,
                      name: identity.name,
                      role: identity.role,
                    }}
                    metadata={null}
                  >
                    <SpecialistTaskCard
                      task={entry.task}
                      onOpenTask={onOpenChild}
                    />
                  </ChiefMessage>
                );
              }
              const { message } = entry;
              if (message.role === "user") {
                return (
                  <div id={`chief-message-${message.id}`} key={message.id}>
                    <UserMessage
                      author={userAuthor}
                      attachments={imageParts(message)}
                      metadata={null}
                      onOpenProfile={openUserProfile}
                      onOpenMention={openAgentMention}
                      text={messageText(message)}
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
                  key={message.id}
                  messageId={message.id}
                  activity={
                    specialist && respondingAgent?.id === specialist.agent
                      ? specialist
                      : undefined
                  }
                  agent={respondingAgent}
                  metadata={null}
                  onOpenProfile={selectProfile}
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
                    onOpenTask={onOpenChild}
                  />
                </ChiefMessage>
              );
            })}
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
                running={controls.status === "running"}
                statusLabel={statusLabel}
                onOpen={() => {
                  setThreadRootId(null);
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
      previousTurns={previousActivityTurns}
      agentLabel={activityAgentLabel}
      contextLabel={channel ? `#${channel.label}` : "this direct message"}
      running={controls.status === "running"}
      statusLabel={statusLabel}
      tasks={childSessions}
      onClose={() => setActivityOpen(false)}
      onOpenTask={onOpenChild}
      sizing={panelSizing}
    />
  ) : null;
}

function messageText(message: ChiefUIMessage) {
  return messageBlocks(message)
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("\n");
}

function ThreadDivider({ count }: { count: number }) {
  return (
    <div className="my-3 flex items-center gap-2">
      <span className="bg-border h-px flex-1" />
      <span className="text-muted-foreground text-[10px]">
        {count} {count === 1 ? "reply" : "replies"}
      </span>
      <span className="bg-border h-px flex-1" />
    </div>
  );
}

function taskStatusLabel(status: string) {
  if (status === "completed") return "Complete";
  if (status === "idle") return "Starting";
  if (status === "waiting") return "Waiting for you";
  if (status === "running") return "Working";
  return status;
}
