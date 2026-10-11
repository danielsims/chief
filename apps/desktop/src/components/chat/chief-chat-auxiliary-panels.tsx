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
import { messageBlocks, useRuntime } from "../../lib/runtime";
import { workspaceAgentName } from "../../lib/workspace-channels";
import { AgentActivityComposerRow } from "./agent-activity-composer-row";
import { AgentActivityPanel } from "./agent-activity-panel";
import {
  formatAgentActivityStatus,
  mergeAgentActivityPresence,
  scheduledAgentActivityPresence,
  taskAgentActivityPresence,
} from "./agent-activity-presence";
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
import { withSpecialistTimelineEntries } from "./conversation-timeline-entries";
import { ObservedChat } from "./observed-chat";
import { ScheduledRunMessage } from "./scheduled-run-message";
import {
  taskActivitySubtitle,
  ThreadSpecialistTaskCard,
} from "./specialist-task-card";
import { UserMessage } from "./user-message";

type Core = ReturnType<typeof useChiefChatCore>;
type Composer = ReturnType<typeof useChiefChatComposer>;
type Timeline = ReturnType<typeof useChiefChatTimeline>;

/**
 * A thread in an agent DM. It behaves like a channel thread, but the agent's
 * tool calls and file changes are shown inline so the thread is the whole
 * picture of the work.
 */
export interface ThreadAgent {
  name: string;
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
  activeThreadSummary,
  composer,
  core,
  imageParts,
  props,
  respondingAgentFor,
  threadAgent,
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
  threadAgent?: ThreadAgent;
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
    interrupt,
    mentionCandidates,
    activityTurns,
    activityAgentId,
    send,
    setActivityOpen,
    statusLabel,
    userAuthor,
    authorFor,
  } = core;
  const {
    openAgentMention,
    openUserProfile,
    openAuthorProfile,
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
      // An agent DM thread is a clean chat: the agent's run is not surfaced
      // as a task card, and its tool calls live in the Activity panel.
      threadAgent
        ? threadReplyEntries
        : withSpecialistTimelineEntries(
            threadReplyEntries,
            activeThreadChildSessions,
          ),
    [activeThreadChildSessions, threadReplyEntries, threadAgent],
  );
  const threadPictureInPictureContainerRef = useRef<HTMLDivElement>(null);
  const threadComposerRef = useRef<HTMLDivElement>(null);
  const threadPictureInPictureAvoidRefs = useMemo(
    () => [threadComposerRef],
    [],
  );
  const { agents: roster } = useRuntime();
  const threadActivityAgents = useMemo(() => {
    const activityAgentName = (agentId: string) =>
      workspaceAgentName(agentId, roster) ?? agentId;
    const root =
      controls.status === "running" &&
      activeRootTurn?.threadRootId === threadRootId
        ? {
            id: activeRootTurn.agentId,
            label: activityAgentName(activeRootTurn.agentId),
          }
        : undefined;
    return mergeAgentActivityPresence(root, [
      ...controls.workingAgents
        .filter((agent) => agent.threadRootId === threadRootId)
        .map((agent) => ({
          id: agent.agentId,
          label: activityAgentName(agent.agentId),
        })),
      ...taskAgentActivityPresence(
        activeThreadChildSessions,
        activityAgentName,
      ),
      ...scheduledAgentActivityPresence(
        core.scheduleRuns,
        activityAgentName,
        threadRootId,
      ),
    ]);
  }, [
    activeRootTurn,
    core.scheduleRuns,
    activeThreadChildSessions,
    controls.status,
    controls.workingAgents,
    roster,
    threadRootId,
  ]);
  // In an agent DM the Activity panel opened from a thread shows that
  // thread's work only, and returns to the thread.
  const threadActivityTurns = useMemo(
    () =>
      threadAgent && threadRootId
        ? activityTurns.filter((turn) => turn.threadRootId === threadRootId)
        : [],
    [activityTurns, threadAgent, threadRootId],
  );
  const threadActivitySteps = threadActivityTurns.reduce(
    (count, turn) =>
      count + turn.blocks.filter((block) => block.type === "tool_use").length,
    0,
  );
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

  if (
    (channel || threadAgent) &&
    threadRootId &&
    !activityOpen &&
    !profileOpen
  ) {
    const thread = (
      <ConversationAuxiliaryPanel
        onClose={() => setThreadRootId(null)}
        sizing={panelSizing}
      >
        <ConversationAuxiliaryPanelHeader
          title={
            <ConversationAuxiliaryBreadcrumb
              current={threadAgent ? threadAgent.name : "Thread"}
              items={[]}
            />
          }
          subtitle={
            threadAgent && threadActivityAgents.length > 0 ? (
              <span className="chief-shimmer-text">
                {threadAgent.name} is working…
              </span>
            ) : (
              `${activeThreadSummary.count} ${activeThreadSummary.count === 1 ? "reply" : "replies"}`
            )
          }
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
            {activeThreadRoot?.metadata?.scheduledRun ? (
              <div className="mx-auto w-full max-w-3xl py-2 pl-11">
                <ScheduledRunMessage
                  run={activeThreadRoot.metadata.scheduledRun}
                  progress={core.scheduleRuns.find(
                    (run) =>
                      run.id === activeThreadRoot.metadata?.scheduledRun?.runId,
                  )}
                />
              </div>
            ) : null}
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
                        author={authorFor(message)}
                        {...(message.metadata?.guest
                          ? { guest: message.metadata.guest }
                          : undefined)}
                        attachments={imageParts(message)}
                        metadata={null}
                        channelReferences={channelReferences}
                        onOpenChannel={onOpenChannel}
                        {...(message.metadata?.guest
                          ? undefined
                          : { onOpenProfile: openAuthorProfile(message) })}
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
            <div ref={threadBottomRef} />
          </ConversationAuxiliaryPanelBody>
          <div ref={threadComposerRef} className="relative shrink-0 px-3 pb-3">
            <div className="relative mx-auto w-full max-w-3xl space-y-2">
              <ChatComposer
                storageKey={`${core.cloudOrganizationId}:thread:${threadRootId}`}
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
                placeholder={
                  threadAgent
                    ? `Message ${threadAgent.name}…`
                    : `Reply in #${channel?.label ?? ""}…`
                }
              />
              <AgentActivityComposerRow
                agents={threadActivityAgents}
                agentLabel={activityAgentLabel}
                running={threadActivityAgents.length > 0}
                statusLabel={threadStatusLabel}
                idleLabel={
                  threadAgent && threadActivityTurns.length > 0
                    ? threadActivitySteps > 0
                      ? `${threadActivitySteps} ${threadActivitySteps === 1 ? "step" : "steps"}`
                      : "Activity"
                    : undefined
                }
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
    return thread;
  }

  const threadScoped = Boolean(threadAgent && threadRootId);
  return activityOpen && !profileOpen && !activeChild ? (
    <AgentActivityPanel
      error={controls.error}
      turns={threadScoped ? threadActivityTurns : activityTurns}
      activeAgentId={activityAgentId}
      running={
        threadScoped
          ? threadActivityAgents.length > 0
          : controls.status === "running"
      }
      tasks={threadScoped ? activeThreadChildSessions : childSessions}
      flat={Boolean(threadAgent)}
      title={threadAgent?.name}
      {...(threadScoped
        ? {
            onBack: () => setActivityOpen(false),
            backLabel: "Back to thread",
          }
        : undefined)}
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
