import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { MessageSquare, X } from "lucide-react";

import type {
  ChatExecutionSelection,
  DriverType,
} from "@chief/agent-runtime/types";

import type { WorkspaceAgentId } from "../../lib/workspace-channels";
import type { SchedulingDraft } from "./recurring-work-composer";
import { useAgentConfig } from "../../lib/agent-config";
import { useAuth } from "../../lib/auth/auth-context";
import {
  findPendingInputRequest,
  withoutMarkerLines,
} from "../../lib/integration-setup";
import {
  messageBlocks,
  useChiefChat,
  useRuntime,
  useWorkspaceData,
} from "../../lib/runtime";
import { WORKSPACE_AGENT_IDENTITIES } from "../../lib/workspace-channels";
import { ChiefMark } from "../chief-mark";
import { InputRequestSection } from "../integrations/input-request-section";
import { AgentActivityComposerRow } from "./agent-activity-composer-row";
import { AgentActivityPanel } from "./agent-activity-panel";
import { ApprovalCard } from "./approval-card";
import { channelActivityState } from "./channel-activity-state";
import { ChatComposer } from "./chat-composer";
import { Blocks } from "./message-blocks";
import { QuestionCard } from "./question-card";
import { RecurringWorkComposer } from "./recurring-work-composer";
import {
  ordinaryToolMessageGroups,
  specialistTaskOwners,
} from "./specialist-task-display";
import { ToolActivityGroup } from "./tool-activity-group";
import { UserMessage } from "./user-message";

function ChiefMessage({
  children,
  agent,
}: {
  children: ReactNode;
  agent?: { name: string; role: string };
}) {
  const identity = agent ?? {
    name: "Chief",
    role: "Chief Marketing Officer",
  };
  return (
    <div className="group/message mx-auto flex w-full max-w-3xl min-w-0 gap-3 py-2">
      <span className="bg-foreground text-background flex size-8 shrink-0 items-center justify-center rounded-lg shadow-[inset_0_1px_rgba(255,255,255,0.1)]">
        <ChiefMark className="size-4" />
      </span>
      <div className="min-w-0 flex-1 pt-0.5">
        <div className="mb-1 flex items-baseline gap-2">
          <strong className="text-[13px] font-semibold">{identity.name}</strong>
          <span className="text-muted-foreground text-[10px]">
            {identity.role}
          </span>
        </div>
        {children}
      </div>
    </div>
  );
}

export function ChiefChat({
  chatId,
  isNew,
  composer,
  composerDate,
  composerPlaybookId,
  initialPrompt,
  initialDraft,
  initialDriver,
  initialModel,
  channel,
  directAgent,
  destinationChannelId,
  onInitialPromptSent,
  onOpenChild,
}: {
  chatId: string;
  /** True for a draft chat with no persisted transcript to replay. */
  isNew?: boolean;
  /** Guided inline setup rendered above the message box. */
  composer?: "recurring" | "oneoff";
  /** Prefilled date (YYYY-MM-DD) for the one-off composer. */
  composerDate?: string;
  /** Prefilled playbook for recurring work. */
  composerPlaybookId?: string;
  initialPrompt?: string;
  initialDraft?: string;
  initialDriver?: DriverType;
  initialModel?: string;
  channel?: {
    label: string;
    description: string;
    agentIds: readonly string[];
  };
  directAgent?: { id: WorkspaceAgentId; name: string; role: string };
  destinationChannelId?: string;
  onInitialPromptSent?: () => void;
  onOpenChild?: (childId: string) => void;
}) {
  const { status: runtimeStatus } = useRuntime();
  const { cloudOrganizationId, user } = useAuth();
  const userAuthor = {
    name: user?.name.trim() ?? "You",
    ...(user?.image ? { image: user.image } : {}),
  };
  const workspaceData = useWorkspaceData(cloudOrganizationId);
  const childSessions = workspaceData.activity
    .filter(
      (session) =>
        session.parentId === chatId &&
        session.kind === "task" &&
        session.visibility === "private" &&
        !session.scheduleId,
    )
    .sort((a, b) => a.createdAt - b.createdAt);
  const agentConfig = useAgentConfig();
  const resolved = agentConfig.forAgent(directAgent?.id ?? "cmo");
  const initialExecution = initialDriver
    ? { driver: initialDriver, model: initialModel }
    : resolved.driver
      ? { driver: resolved.driver, model: resolved.model }
      : undefined;
  const [selectedExecution, setSelectedExecution] =
    useState<ChatExecutionSelection | null>(null);
  const activeCapabilities = resolved.capabilities;
  const {
    messages,
    controls,
    interrupt,
    respondPermission,
    respondQuestion,
    provideInput,
    chatReady,
    execution,
    sendMessageWithContext,
  } = useChiefChat(
    chatId,
    initialExecution,
    selectedExecution ?? undefined,
    agentConfig.access,
    { channelId: destinationChannelId, agentId: directAgent?.id },
  );
  const [activityOpen, setActivityOpen] = useState(false);
  const currentTurn = useMemo(
    () => channelActivityState(messages, controls.hasAgentOutput),
    [controls.hasAgentOutput, messages],
  );
  const currentTurnBlocks = currentTurn.blocks;
  const statusLabel = currentTurn.statusLabel;
  const activeExecution = selectedExecution ?? execution ?? initialExecution;
  const driver = activeExecution?.driver;
  const [answeredInputs, setAnsweredInputs] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const pendingInput = useMemo(
    () => findPendingInputRequest(messages, answeredInputs),
    [messages, answeredInputs],
  );
  const [addedAgentIds, setAddedAgentIds] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const mentionCandidates = useMemo(
    () =>
      Object.entries(WORKSPACE_AGENT_IDENTITIES)
        .filter(([id]) => id !== "setup")
        .map(([id, identity]) => ({
          id,
          ...identity,
          member:
            directAgent?.id === id ||
            addedAgentIds.has(id) ||
            Boolean(channel?.agentIds.includes(id)),
        })),
    [addedAgentIds, channel?.agentIds, directAgent?.id],
  );
  const mentionsIn = (text: string) =>
    mentionCandidates
      .filter((candidate) => text.includes(`@${candidate.name}`))
      .map((candidate) => candidate.id);
  const send = (text: string, threadRootId?: string) => {
    const mentions = mentionsIn(text);
    if (channel && mentions.length > 0) {
      setAddedAgentIds((current) => new Set([...current, ...mentions]));
    }
    sendMessageWithContext(text, {
      threadRootId,
      mentions,
    });
  };
  const [draft, setDraft] = useState(initialDraft ?? "");
  const [threadDraft, setThreadDraft] = useState("");
  const [threadRootId, setThreadRootId] = useState<string | null>(null);
  const [optimisticInitialPrompt] = useState(() => initialPrompt ?? null);
  const [composerOpen, setComposerOpen] = useState(composer !== undefined);
  const [approveAfterCreation, setApproveAfterCreation] = useState(false);
  const autoApproveRef = useRef<{
    submittedAt: number;
    expiresAt: number;
    existingIds: ReadonlySet<string>;
  } | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const sentInitial = useRef(false);

  useEffect(() => {
    const intent = autoApproveRef.current;
    if (!intent) return;
    if (Date.now() > intent.expiresAt) {
      autoApproveRef.current = null;
      return;
    }
    const proposed = workspaceData.recurringWork.find(
      (work) =>
        work.status === "draft" &&
        work.createdAt >= intent.submittedAt &&
        !intent.existingIds.has(work.id),
    );
    if (!proposed) return;
    autoApproveRef.current = null;
    workspaceData.saveRecurringWork({
      ...proposed,
      status: "active",
      grant: {
        version: 1,
        approvedAt: Date.now(),
        toolPatterns: proposed.proposedToolPatterns,
      },
      updatedAt: Date.now(),
    });
    // saveRecurringWork is intentionally invoked once for the proposal that
    // appears after the user's explicit Create as approved submission.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceData.recurringWork]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  useEffect(() => {
    if (
      initialPrompt &&
      !sentInitial.current &&
      driver &&
      chatReady &&
      runtimeStatus === "connected"
    ) {
      // flag is set inside the timeout so a StrictMode remount (which
      // cancels the timer) doesn't permanently swallow the prompt
      const t = setTimeout(() => {
        if (sentInitial.current) return;
        sentInitial.current = true;
        send(initialPrompt);
        onInitialPromptSent?.();
      }, 400);
      return () => clearTimeout(t);
    }
  }, [initialPrompt, runtimeStatus, driver, chatReady]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = () => {
    if (controls.status === "running" || !driver || !chatReady) return;
    const text = draft.trim();
    if (!text) return;
    if (composerOpen && approveAfterCreation) {
      autoApproveRef.current = {
        submittedAt: Date.now(),
        expiresAt: Date.now() + 10 * 60_000,
        existingIds: new Set(
          workspaceData.recurringWork.map((work) => work.id),
        ),
      };
    } else {
      autoApproveRef.current = null;
    }
    setDraft("");
    setComposerOpen(false);
    send(text);
  };

  const composeSchedule = ({
    text,
    approveAfterCreation: nextApproval,
  }: SchedulingDraft) => {
    setDraft(text);
    setApproveAfterCreation(nextApproval);
  };

  const showOptimisticInitialPrompt = Boolean(
    optimisticInitialPrompt &&
    !messages.some(
      (message) =>
        message.role === "user" &&
        messageBlocks(message).some(
          (part) =>
            part.type === "text" && part.text === optimisticInitialPrompt,
        ),
    ),
  );
  const childSessionOwners = specialistTaskOwners(
    messages.flatMap((message) =>
      message.role === "assistant"
        ? [
            {
              id: message.id,
              blocks: withoutMarkerLines(messageBlocks(message)),
            },
          ]
        : [],
    ),
    childSessions,
  );
  const ordinaryToolGroups = ordinaryToolMessageGroups(
    messages.map((message) => ({
      id: message.id,
      role: message.role,
      blocks: withoutMarkerLines(messageBlocks(message)),
    })),
    childSessions,
  );
  const threadReplies = useMemo(() => {
    const replies = new Map<string, typeof messages>();
    for (const message of messages) {
      const rootId = message.metadata?.threadRootId;
      if (!rootId) continue;
      const current = replies.get(rootId) ?? [];
      current.push(message);
      replies.set(rootId, current);
    }
    return replies;
  }, [messages]);
  const activeThreadRoot = threadRootId
    ? messages.find((message) => message.id === threadRootId)
    : undefined;
  const activeThreadReplies = threadRootId
    ? (threadReplies.get(threadRootId) ?? [])
    : [];

  return (
    <div className="relative flex h-full min-w-0 overflow-hidden">
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="min-w-0 flex-1 space-y-3 overflow-x-hidden overflow-y-auto py-6 pr-2">
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
          {!chatReady && !isNew && !composerOpen && messages.length === 0 ? (
            <div className="text-muted-foreground flex h-full items-center justify-center font-mono text-xs">
              Loading conversation…
            </div>
          ) : null}
          {(chatReady || isNew) &&
          !composerOpen &&
          messages.length === 0 &&
          !showOptimisticInitialPrompt ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
              <p className="text-2xl font-medium tracking-[-0.03em]">
                {channel ? `#${channel.label}` : (directAgent?.name ?? "Chief")}
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
                  {channel.agentIds.length} agents share this channel’s context.
                </p>
              ) : null}
              {runtimeStatus !== "connected" && (
                <p className="text-muted-foreground mt-4 border border-dashed px-3 py-2 text-xs">
                  Agent runtime not connected. Run <code>pnpm dev</code> in the
                  repo root.
                </p>
              )}
            </div>
          ) : null}
          {showOptimisticInitialPrompt && optimisticInitialPrompt ? (
            <UserMessage text={optimisticInitialPrompt} author={userAuthor} />
          ) : null}
          {messages.map((message) => {
            if (channel && message.metadata?.threadRootId) return null;
            if (message.role === "user") {
              return message.id === `${chatId}-kickoff` ? (
                <div
                  key={message.id}
                  className="mx-auto w-full max-w-3xl border-y py-4"
                >
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <span className="size-1.5 bg-blue-500" />
                    Initial business review
                  </div>
                  <p className="text-muted-foreground mt-1 pl-3.5 text-xs">
                    Chief is learning your business. Research and specialist
                    work will appear here as it happens.
                  </p>
                </div>
              ) : (
                <div key={message.id}>
                  <UserMessage
                    author={userAuthor}
                    text={messageBlocks(message)
                      .flatMap((part) =>
                        part.type === "text" ? [part.text] : [],
                      )
                      .join("\n")}
                  />
                  {channel ? (
                    <div className="mx-auto -mt-1 flex w-full max-w-3xl pl-11">
                      <button
                        type="button"
                        onClick={() => {
                          setActivityOpen(false);
                          setThreadRootId(message.id);
                        }}
                        className="text-muted-foreground hover:bg-accent hover:text-foreground flex h-7 items-center gap-1.5 rounded-lg px-2 text-[11px] transition-colors"
                      >
                        <MessageSquare size={12} />
                        {(threadReplies.get(message.id)?.length ?? 0) > 0
                          ? `${threadReplies.get(message.id)?.length} replies`
                          : "Reply in thread"}
                      </button>
                    </div>
                  ) : null}
                </div>
              );
            }
            if (message.role !== "assistant") return null;
            if (
              channel &&
              currentTurn.messageIds.has(message.id) &&
              (controls.status === "running" ||
                message.id !== currentTurn.finalTextMessageId)
            ) {
              return null;
            }
            const toolGroup = ordinaryToolGroups.get(message.id);
            if (toolGroup) {
              if (channel) return null;
              return toolGroup.ownerId === message.id ? (
                <ChiefMessage key={message.id} agent={directAgent}>
                  <ToolActivityGroup
                    blocks={toolGroup.blocks}
                    progress={controls.toolProgress}
                    active={controls.status === "running"}
                  />
                </ChiefMessage>
              ) : null;
            }
            const blocks = withoutMarkerLines(messageBlocks(message));
            const timelineBlocks = channel
              ? blocks.filter(
                  (block) =>
                    block.type !== "tool_use" &&
                    block.type !== "tool_result" &&
                    block.type !== "thinking",
                )
              : blocks;
            if (timelineBlocks.length === 0) return null;
            return (
              <ChiefMessage key={message.id} agent={directAgent}>
                <Blocks
                  blocks={timelineBlocks}
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
          {controls.approvals.map((approval) => (
            <div key={approval.requestId} className="mx-auto max-w-3xl">
              <ApprovalCard approval={approval} onRespond={respondPermission} />
            </div>
          ))}
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
            <p className="border-destructive/40 text-destructive mx-auto max-w-3xl border px-3 py-2 text-xs">
              {controls.error}
            </p>
          )}
          <div ref={bottomRef} />
        </div>

        <div className="mx-auto w-full max-w-3xl space-y-2">
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
            value={draft}
            onValueChange={setDraft}
            onSubmit={submit}
            execution={activeExecution}
            onExecutionChange={setSelectedExecution}
            running={controls.status === "running"}
            onInterrupt={interrupt}
            showSuggestions={!composerOpen && controls.status !== "running"}
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
            running={Boolean(channel && controls.status === "running")}
            statusLabel={statusLabel}
            onOpen={() => setActivityOpen(true)}
          />
        </div>
      </div>
      {channel && threadRootId ? (
        <aside className="bg-background flex min-h-0 w-[380px] shrink-0 flex-col border-l max-[900px]:absolute max-[900px]:inset-y-0 max-[900px]:right-0 max-[900px]:z-40 max-[900px]:w-[min(92%,380px)]">
          <header className="flex h-12 shrink-0 items-center justify-between border-b px-4">
            <div>
              <p className="text-xs font-semibold">Thread</p>
              <p className="text-muted-foreground text-[10px]">
                #{channel.label} · {activeThreadReplies.length} replies
              </p>
            </div>
            <button
              type="button"
              aria-label="Close thread"
              onClick={() => setThreadRootId(null)}
              className="text-muted-foreground hover:bg-accent hover:text-foreground flex size-8 items-center justify-center rounded-lg"
            >
              <X size={15} />
            </button>
          </header>
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 py-4">
            {activeThreadRoot?.role === "user" ? (
              <UserMessage
                author={userAuthor}
                text={messageBlocks(activeThreadRoot)
                  .flatMap((part) => (part.type === "text" ? [part.text] : []))
                  .join("\n")}
              />
            ) : null}
            <div className="my-3 flex items-center gap-2">
              <span className="bg-border h-px flex-1" />
              <span className="text-muted-foreground text-[10px]">
                {activeThreadReplies.length} replies
              </span>
              <span className="bg-border h-px flex-1" />
            </div>
            {activeThreadReplies.map((message) =>
              message.role === "user" ? (
                <UserMessage
                  key={message.id}
                  author={userAuthor}
                  text={messageBlocks(message)
                    .flatMap((part) =>
                      part.type === "text" ? [part.text] : [],
                    )
                    .join("\n")}
                />
              ) : (
                <ChiefMessage key={message.id} agent={directAgent}>
                  <Blocks
                    blocks={withoutMarkerLines(messageBlocks(message)).filter(
                      (block) =>
                        block.type !== "tool_use" &&
                        block.type !== "tool_result" &&
                        block.type !== "thinking",
                    )}
                    progress={controls.toolProgress}
                    capabilities={activeCapabilities}
                    active={controls.status === "running"}
                    tasks={childSessions}
                    taskOwners={childSessionOwners}
                    ownerId={message.id}
                    onOpenTask={onOpenChild}
                  />
                </ChiefMessage>
              ),
            )}
          </div>
          <div className="shrink-0 px-3 pb-3">
            <ChatComposer
              value={threadDraft}
              onValueChange={setThreadDraft}
              onSubmit={() => {
                const text = threadDraft.trim();
                if (!text || controls.status === "running") return;
                setThreadDraft("");
                send(text, threadRootId);
              }}
              running={controls.status === "running"}
              onInterrupt={interrupt}
              showSuggestions={false}
              showExecutionControls={false}
              mentionCandidates={mentionCandidates}
              placeholder={`Reply in #${channel.label}…`}
            />
          </div>
        </aside>
      ) : null}
      {channel && activityOpen ? (
        <AgentActivityPanel
          blocks={currentTurnBlocks}
          channelLabel={channel.label}
          progress={controls.toolProgress}
          running={controls.status === "running"}
          statusLabel={statusLabel}
          tasks={childSessions}
          onClose={() => setActivityOpen(false)}
          onOpenTask={onOpenChild}
        />
      ) : null}
    </div>
  );
}
