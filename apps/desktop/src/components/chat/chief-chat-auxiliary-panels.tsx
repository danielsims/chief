import type { ReactNode } from "react";
import { Fragment } from "react";

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
  browserAttachmentNode,
  composer,
  core,
  imageParts,
  props,
  respondingAgentFor,
  threadBlocks,
  timeline,
}: {
  activeThreadSummary: ThreadSummary;
  browserAttachmentNode: (run: BrowserRunRecord) => ReactNode;
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
    | "onOpenInternalPanel"
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
    onOpenInternalPanel,
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
  const closeAuxiliaryWorkspace = () => {
    setActivityOpen(false);
    setThreadRootId(null);
    onCloseChild?.();
  };
  const returnToThread = () => {
    if (!activeChildThreadRootId) return;
    setActivityOpen(false);
    onCloseChild?.();
    setThreadRootId(activeChildThreadRootId);
  };
  const returnFromChild = () => {
    onCloseChild?.();
    if (activeChildThreadRootId) {
      setActivityOpen(false);
      setThreadRootId(activeChildThreadRootId);
    }
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
        <ConversationAuxiliaryPanelBody className="overflow-hidden">
          <ObservedChat
            key={activeChild.id}
            chatId={activeChild.id}
            showHeader={false}
            inlineAttachment={
              childBrowserRun ? (
                <BrowserSessionAttachment
                  operating={browserOperating}
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
                {browserAttachmentNode(run)}
              </Fragment>
            ) : null,
          )}
          <ThreadDivider count={activeThreadSummary.count} />
          {threadReplyEntries.map((entry) => {
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
            return (
              <ChiefMessage
                key={message.id}
                messageId={message.id}
                agent={respondingAgentFor(message)}
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
        <div className="relative shrink-0 px-3 pb-3">
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
                onOpenInternalPanel?.();
              }}
            />
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
  if (status === "running" || status === "waiting") return "Working";
  return status;
}
