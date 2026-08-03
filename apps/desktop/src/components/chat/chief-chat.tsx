/* eslint-disable max-lines */

import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";

import type {
  BrowserRunRecord,
  ChatExecutionSelection,
  ChiefMessageMetadata,
  ChiefUIMessage,
  DriverType,
  MessageAttachment,
  SessionRecord,
} from "@chief/agent-runtime/types";

import type { WorkspaceAgentId } from "../../lib/workspace-channels";
import type { ThreadParticipant } from "./channel-message-controls";
import type { ComposerImageAttachment } from "./composer-image-attachments";
import type { ConversationAuxiliaryPanelSizing } from "./conversation-auxiliary-panel";
import type { ConversationProfileSelection } from "./conversation-profile";
import type { SchedulingDraft } from "./recurring-work-composer";
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
import {
  GETTING_STARTED_CHANNEL_RELAY_ID,
  WORKSPACE_AGENT_IDENTITIES,
} from "../../lib/workspace-channels";
import { AgentAvatar } from "../agent-avatar";
import { InputRequestSection } from "../integrations/input-request-section";
import { AgentActivityComposerRow } from "./agent-activity-composer-row";
import { AgentActivityPanel, taskAgentLabel } from "./agent-activity-panel";
import { ApprovalCard } from "./approval-card";
import {
  BrowserSessionAttachment,
  BrowserSessionPortal,
} from "./browser-panel";
import { channelActivityState } from "./channel-activity-state";
import {
  ChannelMessageActions,
  ChannelMessageMeta,
} from "./channel-message-controls";
import {
  channelRecipients,
  threadAgentAudience,
} from "./channel-thread-audience";
import { ChatComposer } from "./chat-composer";
import {
  ConversationAuxiliaryBreadcrumb,
  ConversationAuxiliaryPanel,
  ConversationAuxiliaryPanelBody,
  ConversationAuxiliaryPanelHeader,
} from "./conversation-auxiliary-panel";
import { Blocks } from "./message-blocks";
import { ObservedChat } from "./observed-chat";
import { QuestionCard } from "./question-card";
import { RecurringWorkComposer } from "./recurring-work-composer";
import {
  ordinaryToolMessageGroups,
  specialistTaskOwners,
  specialistTasksForInput,
} from "./specialist-task-display";
import { summarizeThreadReplyCandidates } from "./thread-reply-summary";
import { UserMessage } from "./user-message";

function browserHostname(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function ChiefMessage({
  children,
  agent,
  messageId,
  onOpenProfile,
  actions,
  footer,
  metadata,
}: {
  children: ReactNode;
  agent?: { id: WorkspaceAgentId; name: string; role: string };
  messageId?: string;
  onOpenProfile?: (selection: ConversationProfileSelection) => void;
  actions?: ReactNode;
  footer?: ReactNode;
  metadata?: ReactNode;
}) {
  const identity = agent ?? {
    name: "Chief",
    role: "Chief Marketing Officer",
  };
  const agentId = agent?.id ?? "cmo";
  const resolvedMetadata = metadata === undefined ? identity.role : metadata;
  return (
    <div
      id={messageId ? `chief-message-${messageId}` : undefined}
      className="group/message relative mx-auto flex w-full max-w-3xl min-w-0 items-start gap-3 py-2"
    >
      {actions}
      <button
        type="button"
        aria-label={`Open ${identity.name} profile`}
        title={`Open ${identity.name} profile`}
        disabled={!onOpenProfile}
        onClick={() => onOpenProfile?.({ kind: "agent", agentId })}
        className="focus-visible:ring-ring/30 shrink-0 rounded-full transition-opacity outline-none enabled:hover:opacity-85 enabled:focus-visible:ring-2 disabled:cursor-default"
      >
        <AgentAvatar label={identity.name} />
      </button>
      <div className="min-w-0 flex-1 pt-0.5">
        <div className="mb-1 flex items-baseline gap-2">
          <strong className="text-[13px] font-semibold">{identity.name}</strong>
          {resolvedMetadata ? (
            <span className="text-muted-foreground text-[10px]">
              {resolvedMetadata}
            </span>
          ) : null}
        </div>
        {children}
        {footer}
      </div>
    </div>
  );
}

function ChannelMembershipMessage({
  action,
  userImage,
}: {
  action: NonNullable<ChiefMessageMetadata["channelAction"]>;
  userImage?: string;
}) {
  const agentNames = action.agentIds.map((agentId) => {
    if (!Object.hasOwn(WORKSPACE_AGENT_IDENTITIES, agentId)) return agentId;
    return WORKSPACE_AGENT_IDENTITIES[agentId as WorkspaceAgentId].name;
  });
  return (
    <div className="text-muted-foreground mx-auto flex w-full max-w-3xl items-center gap-2.5 py-2 pl-11 text-xs">
      <span className="bg-muted flex size-5 shrink-0 items-center justify-center overflow-hidden rounded-full text-[8px] font-semibold">
        {userImage ? (
          <img src={userImage} alt="" className="size-full object-cover" />
        ) : (
          action.actorName.charAt(0).toUpperCase()
        )}
      </span>
      <span>
        <strong className="text-foreground font-medium">
          {action.actorName}
        </strong>{" "}
        added{" "}
        <strong className="text-foreground font-medium">
          {agentNames.join(", ")}
        </strong>{" "}
        to the channel
      </span>
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
  activeChild,
  onInitialPromptSent,
  onCloseChild,
  onOpenChild,
  onOpenProfile,
  onOpenInternalPanel,
  panelSizing,
  profileOpen = false,
  header,
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
  initialAttachments?: readonly MessageAttachment[];
  initialDraft?: string;
  initialMessageId?: string;
  initialThreadRootId?: string;
  focusComposer?: boolean;
  initialDriver?: DriverType;
  initialModel?: string;
  channel?: {
    label: string;
    description: string;
    agentIds: readonly string[];
  };
  directAgent?: { id: WorkspaceAgentId; name: string; role: string };
  destinationChannelId?: string;
  activeChild?: SessionRecord;
  onInitialPromptSent?: () => void;
  onCloseChild?: () => void;
  onOpenChild?: (childId: string) => void;
  onOpenProfile?: (selection: ConversationProfileSelection) => void;
  onOpenInternalPanel?: () => void;
  panelSizing: ConversationAuxiliaryPanelSizing;
  profileOpen?: boolean;
  /** Conversation chrome belongs to the main split pane so auxiliary headers
   * can align across the full-height divider. */
  header?: ReactNode;
}) {
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
  const workspaceData = useWorkspaceData(cloudOrganizationId);
  const channelReactions = useChannelReactions(
    channel ? (destinationChannelId ?? null) : null,
  );
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
  const isGettingStarted =
    destinationChannelId === GETTING_STARTED_CHANNEL_RELAY_ID;
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
    isGettingStarted ? "full" : resolved.access,
    {
      channelId: destinationChannelId,
      agentId: directAgent?.id,
      wakeOnMentionOnly: Boolean(channel),
    },
  );
  const [activityOpen, setActivityOpen] = useState(false);
  const [browserOpen, setBrowserOpen] = useState(false);
  const [browserInlineTarget, setBrowserInlineTarget] =
    useState<HTMLDivElement | null>(null);
  const [browserPanelTarget, setBrowserPanelTarget] =
    useState<HTMLDivElement | null>(null);
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
    [addedAgentIds, channel?.agentIds, directAgent?.id],
  );
  const knownAgentIds = useMemo(
    () => new Set(mentionCandidates.map((candidate) => candidate.id)),
    [mentionCandidates],
  );
  const mentionsIn = (text: string) => {
    const normalizedText = text.toLocaleLowerCase();
    return mentionCandidates
      .map((candidate) => ({
        id: candidate.id,
        position: normalizedText.indexOf(
          `@${candidate.name.toLocaleLowerCase()}`,
        ),
      }))
      .filter((mention) => mention.position >= 0)
      .sort((left, right) => left.position - right.position)
      .map((mention) => mention.id);
  };
  const send = (
    text: string,
    threadRootId?: string,
    inheritedThreadAudience: readonly string[] = [],
    attachments: readonly MessageAttachment[] = [],
  ) => {
    const mentions = channelRecipients(
      mentionsIn(text),
      inheritedThreadAudience,
      knownAgentIds,
    );
    if (channel && mentions.length > 0) {
      setAddedAgentIds((current) => new Set([...current, ...mentions]));
    }
    sendMessageWithContext(
      text,
      {
        threadRootId,
        mentions,
      },
      [...attachments],
    );
  };
  const [draft, setDraft] = useState(initialDraft ?? "");
  const [threadDraft, setThreadDraft] = useState("");
  const [imageAttachments, setImageAttachments] = useState<
    ComposerImageAttachment[]
  >([]);
  const [threadImageAttachments, setThreadImageAttachments] = useState<
    ComposerImageAttachment[]
  >([]);
  const [threadRootId, setThreadRootId] = useState<string | null>(
    initialThreadRootId ?? null,
  );
  const centeredMessageRef = useRef<string | null>(null);
  const suppressMainAutoScrollRef = useRef(
    Boolean(initialMessageId && !initialThreadRootId),
  );
  const suppressThreadAutoScrollRef = useRef(
    Boolean(initialMessageId && initialThreadRootId),
  );
  useEffect(() => {
    centeredMessageRef.current = null;
    suppressMainAutoScrollRef.current = Boolean(
      initialMessageId && !initialThreadRootId,
    );
    suppressThreadAutoScrollRef.current = Boolean(
      initialMessageId && initialThreadRootId,
    );
  }, [initialMessageId, initialThreadRootId]);
  useEffect(() => {
    if (!initialMessageId || centeredMessageRef.current === initialMessageId)
      return;
    let highlightTimer = 0;
    const frame = window.requestAnimationFrame(() => {
      const target = document.getElementById(
        `chief-message-${initialMessageId}`,
      );
      if (!target) return;
      centeredMessageRef.current = initialMessageId;
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      target.classList.add("chief-message-notification-target");
      highlightTimer = window.setTimeout(() => {
        target.classList.remove("chief-message-notification-target");
      }, 2400);
    });
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(highlightTimer);
    };
  }, [initialMessageId, messages.length, threadRootId]);

  const selectProfile = (selection: ConversationProfileSelection) => {
    setActivityOpen(false);
    setBrowserOpen(false);
    setThreadRootId(null);
    onOpenProfile?.(selection);
  };
  const openUserProfile = onOpenProfile
    ? () => selectProfile({ kind: "user" })
    : undefined;
  const openAgentMention = onOpenProfile
    ? (agentId: WorkspaceAgentId) => selectProfile({ kind: "agent", agentId })
    : undefined;
  const [optimisticInitialPrompt] = useState(() => initialPrompt ?? null);
  const [composerOpen, setComposerOpen] = useState(composer !== undefined);
  const [approveAfterCreation, setApproveAfterCreation] = useState(false);
  const autoApproveRef = useRef<{
    submittedAt: number;
    expiresAt: number;
    existingIds: ReadonlySet<string>;
  } | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const threadBottomRef = useRef<HTMLDivElement>(null);
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
    if (suppressMainAutoScrollRef.current) {
      if (
        initialMessageId &&
        !document.getElementById(`chief-message-${initialMessageId}`)
      )
        return;
      suppressMainAutoScrollRef.current = false;
      return;
    }
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [initialMessageId, messages.length]);

  useEffect(() => {
    if (
      (initialPrompt !== undefined || initialAttachments.length > 0) &&
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
        send(initialPrompt ?? "", undefined, [], initialAttachments);
        onInitialPromptSent?.();
      }, 400);
      return () => clearTimeout(t);
    }
  }, [initialPrompt, initialAttachments, runtimeStatus, driver, chatReady]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = () => {
    if (controls.status === "running" || !driver || !chatReady) return;
    const text = draft.trim();
    if (!text && imageAttachments.length === 0) return;
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
    setImageAttachments([]);
    setComposerOpen(false);
    send(text, undefined, [], imageAttachments);
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
  const activeChildOwnerId = activeChild
    ? childSessionOwners.get(activeChild.id)
    : undefined;
  const activeChildOwner = activeChildOwnerId
    ? messages.find((message) => message.id === activeChildOwnerId)
    : undefined;
  const activeChildThreadRootId =
    activeChildOwner?.metadata?.threadRootId ?? threadRootId;
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
  const activeThreadRoot = useMemo(
    () =>
      threadRootId
        ? messages.find((message) => message.id === threadRootId)
        : undefined,
    [messages, threadRootId],
  );
  const activeThreadReplies = useMemo(
    () => (threadRootId ? (threadReplies.get(threadRootId) ?? []) : []),
    [threadReplies, threadRootId],
  );
  useEffect(() => {
    if (!channel || !destinationChannelId || !threadRootId) {
      if (destinationChannelId) setVisibleThread(destinationChannelId, null);
      return;
    }
    setVisibleThread(destinationChannelId, threadRootId);
    markThreadRead(destinationChannelId, threadRootId);
    return () => setVisibleThread(destinationChannelId, null);
  }, [
    activeThreadReplies.length,
    channel,
    destinationChannelId,
    markThreadRead,
    setVisibleThread,
    threadRootId,
  ]);
  useEffect(() => {
    if (!threadRootId) return;
    if (suppressThreadAutoScrollRef.current) {
      if (
        initialMessageId &&
        !document.getElementById(`chief-message-${initialMessageId}`)
      )
        return;
      suppressThreadAutoScrollRef.current = false;
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      threadBottomRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "end",
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeThreadReplies.length, initialMessageId, threadRootId]);
  const activeThreadAudience = useMemo(
    () =>
      threadAgentAudience(
        activeThreadRoot
          ? [activeThreadRoot, ...activeThreadReplies]
          : activeThreadReplies,
        knownAgentIds,
      ),
    [activeThreadReplies, activeThreadRoot, knownAgentIds],
  );
  const chatBrowserSession = browserSessions[chatId];
  const childBrowserSession = activeChild
    ? browserSessions[activeChild.id]
    : undefined;
  const browserBelongsToChat = Boolean(
    chatBrowserSession?.workspaceId === cloudOrganizationId,
  );
  const browserInThread = Boolean(
    browserBelongsToChat &&
    chatBrowserSession?.threadRootId &&
    chatBrowserSession.threadRootId === threadRootId,
  );
  const browserInTimeline =
    browserBelongsToChat && !chatBrowserSession?.threadRootId;
  const browserInActiveChild = Boolean(
    childBrowserSession?.workspaceId === cloudOrganizationId,
  );
  const browserPanelConversationId =
    browserInActiveChild && activeChild ? activeChild.id : chatId;
  const browserPanelSession = browserSessions[browserPanelConversationId];
  const browserOperating = browserInActiveChild
    ? activeChild?.status === "running" || activeChild?.status === "waiting"
    : controls.status === "running";
  const derivedBrowserAnchorId = browserInThread
    ? (activeThreadReplies.at(-1)?.id ?? activeThreadRoot?.id ?? null)
    : browserInTimeline
      ? ([...messages]
          .reverse()
          .find((message) => !message.metadata?.threadRootId)?.id ?? null)
      : null;
  const browserAnchorId =
    chatBrowserSession?.anchorMessageId ?? derivedBrowserAnchorId;
  useEffect(() => {
    if (
      !chatBrowserSession ||
      chatBrowserSession.anchorMessageId ||
      !derivedBrowserAnchorId
    ) {
      return;
    }
    anchorBrowserSession(chatId, derivedBrowserAnchorId);
  }, [
    anchorBrowserSession,
    chatBrowserSession,
    chatId,
    derivedBrowserAnchorId,
  ]);
  const conversationBrowserRuns = useMemo(
    () =>
      browserRuns.filter(
        (run) =>
          run.workspaceId === cloudOrganizationId &&
          run.conversationId === chatId,
      ),
    [browserRuns, chatId, cloudOrganizationId],
  );
  const timelineBrowserRuns = useMemo(
    () => conversationBrowserRuns.filter((run) => !run.threadRootId),
    [conversationBrowserRuns],
  );
  const activeThreadBrowserRuns = useMemo(
    () =>
      threadRootId
        ? conversationBrowserRuns.filter(
            (run) => run.threadRootId === threadRootId,
          )
        : [],
    [conversationBrowserRuns, threadRootId],
  );
  const timelineEntries = useMemo(() => {
    const entries: (
      | { type: "message"; message: ChiefUIMessage }
      | { type: "browser"; key: string; run?: BrowserRunRecord }
    )[] = [];
    const inserted = new Set<string>();
    const visibleRuns = [...timelineBrowserRuns];
    if (
      browserInTimeline &&
      (!chatBrowserSession?.runId ||
        !visibleRuns.some((run) => run.id === chatBrowserSession.runId))
    ) {
      visibleRuns.push({
        id: `pending:${chatId}`,
        workspaceId: cloudOrganizationId ?? "",
        conversationId: chatId,
        ...(browserAnchorId ? { anchorMessageId: browserAnchorId } : {}),
        url: chatBrowserSession?.url ?? "about:blank",
        status: chatBrowserSession?.status ?? "active",
        createdAt: 0,
        updatedAt: 0,
      });
    }
    for (const message of messages) {
      entries.push({ type: "message", message });
      for (const run of visibleRuns) {
        if (run.anchorMessageId !== message.id) continue;
        entries.push({ type: "browser", key: run.id, run });
        inserted.add(run.id);
      }
    }
    for (const run of visibleRuns) {
      if (!inserted.has(run.id)) {
        entries.push({ type: "browser", key: run.id, run });
      }
    }
    return entries;
  }, [
    browserAnchorId,
    browserInTimeline,
    chatBrowserSession,
    chatId,
    cloudOrganizationId,
    messages,
    timelineBrowserRuns,
  ]);
  const threadReplyEntries = useMemo(() => {
    const entries: (
      | { type: "message"; message: ChiefUIMessage }
      | { type: "browser"; key: string; run?: BrowserRunRecord }
    )[] = [];
    const inserted = new Set<string>();
    const visibleRuns = [...activeThreadBrowserRuns];
    if (
      browserInThread &&
      (!chatBrowserSession?.runId ||
        !visibleRuns.some((run) => run.id === chatBrowserSession.runId))
    ) {
      visibleRuns.push({
        id: `pending:${chatId}`,
        workspaceId: cloudOrganizationId ?? "",
        conversationId: chatId,
        ...(threadRootId ? { threadRootId } : {}),
        ...(browserAnchorId ? { anchorMessageId: browserAnchorId } : {}),
        url: chatBrowserSession?.url ?? "about:blank",
        status: chatBrowserSession?.status ?? "active",
        createdAt: 0,
        updatedAt: 0,
      });
    }
    for (const run of visibleRuns) {
      if (run.anchorMessageId === activeThreadRoot?.id) inserted.add(run.id);
    }
    for (const message of activeThreadReplies) {
      entries.push({ type: "message", message });
      for (const run of visibleRuns) {
        if (run.anchorMessageId !== message.id) continue;
        entries.push({ type: "browser", key: run.id, run });
        inserted.add(run.id);
      }
    }
    for (const run of visibleRuns) {
      if (!inserted.has(run.id)) {
        entries.push({ type: "browser", key: run.id, run });
      }
    }
    return entries;
  }, [
    activeThreadBrowserRuns,
    activeThreadReplies,
    activeThreadRoot?.id,
    browserAnchorId,
    browserInThread,
    chatBrowserSession,
    chatId,
    cloudOrganizationId,
    threadRootId,
  ]);
  const threadRootBrowserRuns = activeThreadBrowserRuns.filter(
    (run) => run.anchorMessageId === activeThreadRoot?.id,
  );
  const threadRootBrowserEntries: BrowserRunRecord[] = [
    ...threadRootBrowserRuns,
  ];
  if (
    browserInThread &&
    browserAnchorId === activeThreadRoot?.id &&
    (!chatBrowserSession?.runId ||
      !threadRootBrowserEntries.some(
        (run) => run.id === chatBrowserSession.runId,
      ))
  ) {
    threadRootBrowserEntries.push({
      id: `pending:${chatId}`,
      workspaceId: cloudOrganizationId ?? "",
      conversationId: chatId,
      ...(threadRootId ? { threadRootId } : {}),
      ...(browserAnchorId ? { anchorMessageId: browserAnchorId } : {}),
      url: chatBrowserSession?.url ?? "about:blank",
      status: chatBrowserSession?.status ?? "active",
      createdAt: 0,
      updatedAt: 0,
    });
  }
  const openBrowserPanel = () => {
    setActivityOpen(false);
    setBrowserOpen(true);
    if (!activeChild) onOpenInternalPanel?.();
  };
  const closeAuxiliaryWorkspace = () => {
    setBrowserOpen(false);
    setActivityOpen(false);
    setThreadRootId(null);
    onCloseChild?.();
  };
  const returnToThread = () => {
    if (!activeChildThreadRootId) return;
    setBrowserOpen(false);
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
  const returnFromBrowserPanel = () => {
    if (activeChild && activeChildThreadRootId) {
      returnToThread();
      return;
    }
    setBrowserOpen(false);
  };
  const channelVisibleBlocks = (message: ChiefUIMessage) =>
    withoutMarkerLines(messageBlocks(message)).filter(
      (block) =>
        block.type !== "thinking" &&
        block.type !== "tool_result" &&
        (block.type !== "tool_use" ||
          specialistTasksForInput(block.input, childSessions).length > 0),
    );
  const summarizeThreadReplies = (replies: readonly ChiefUIMessage[]) => {
    const summary = summarizeThreadReplyCandidates(
      replies.map((reply) => ({
        role: reply.role,
        createdAt: reply.metadata?.createdAt,
        blocks: withoutMarkerLines(messageBlocks(reply)),
        visibleBlocks: channelVisibleBlocks(reply),
      })),
    );
    return {
      ...summary,
      visibleReplies: summary.visibleIndexes.flatMap((index) =>
        replies[index] ? [replies[index]] : [],
      ),
    };
  };
  const activeThreadSummary = summarizeThreadReplies(activeThreadReplies);
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
  const controlsForMessage = (message: ChiefUIMessage) => {
    if (!channel) return {};
    const replies = threadReplies.get(message.id) ?? [];
    const replySummary = summarizeThreadReplies(replies);
    const text = messageBlocks(message)
      .flatMap((part) => (part.type === "text" ? [part.text] : []))
      .join("\n");
    const openThread = () => {
      setActivityOpen(false);
      setBrowserOpen(false);
      setThreadRootId(message.id);
      onOpenInternalPanel?.();
    };
    const toggleReaction = (emoji: string) =>
      channelReactions.toggleReaction(message.id, emoji);
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
          id: "cmo" as const,
          name: "Chief",
        };
        return [
          {
            id: `agent:${agent.id}`,
            kind: "agent",
            name: agent.name,
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
          onOpenThread={openThread}
          onToggleReaction={toggleReaction}
        />
      ),
    };
  };
  const respondingAgentFor = (message: ChiefUIMessage) => {
    if (directAgent) return directAgent;
    const mentionedId = message.metadata?.mentions?.find((agentId) =>
      Object.hasOwn(WORKSPACE_AGENT_IDENTITIES, agentId),
    ) as WorkspaceAgentId | undefined;
    const identity = mentionedId
      ? WORKSPACE_AGENT_IDENTITIES[mentionedId]
      : undefined;
    return mentionedId && identity
      ? { id: mentionedId, name: identity.name, role: identity.role }
      : undefined;
  };

  return (
    <div className="relative flex h-full min-w-0 overflow-hidden">
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {header}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden px-5 pb-3">
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
                metadata={channel ? null : undefined}
                onOpenProfile={openUserProfile}
                onOpenMention={openAgentMention}
              />
            ) : null}
            {timelineEntries.map((entry) => {
              if (entry.type === "browser") {
                return (
                  <div
                    key={entry.key}
                    className="mx-auto w-full max-w-3xl py-1"
                  >
                    <BrowserSessionAttachment
                      conversationId={chatId}
                      detached={
                        browserOpen &&
                        (entry.run?.id.startsWith("pending:") === true ||
                          entry.run?.id === chatBrowserSession?.runId)
                      }
                      operating={controls.status === "running"}
                      onOpenPanel={openBrowserPanel}
                      run={entry.run}
                      targetRef={
                        entry.run?.id.startsWith("pending:") ||
                        entry.run?.id === chatBrowserSession?.runId
                          ? setBrowserInlineTarget
                          : undefined
                      }
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
                  <div id={`chief-message-${message.id}`} key={message.id}>
                    <UserMessage
                      author={userAuthor}
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
              const blocks = withoutMarkerLines(messageBlocks(message));
              const specialistBlocks = blocks.filter(
                (block) =>
                  block.type === "tool_use" &&
                  specialistTasksForInput(block.input, childSessions).length >
                    0,
              );
              if (
                channel &&
                currentTurn.messageIds.has(message.id) &&
                (controls.status === "running" ||
                  message.id !== currentTurn.finalTextMessageId) &&
                specialistBlocks.length === 0
              ) {
                return null;
              }
              const toolGroup = ordinaryToolGroups.get(message.id);
              if (toolGroup) return null;
              const timelineBlocks = channel
                ? channelVisibleBlocks(message)
                : blocks;
              if (timelineBlocks.length === 0) return null;
              const specialistOnly =
                timelineBlocks.length > 0 &&
                timelineBlocks.every((block) => block.type === "tool_use");
              if (specialistOnly) {
                return (
                  <div
                    key={message.id}
                    className="mx-auto w-full max-w-3xl pl-11"
                  >
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
                  </div>
                );
              }
              return (
                <ChiefMessage
                  key={message.id}
                  messageId={message.id}
                  agent={respondingAgentFor(message)}
                  metadata={channel ? null : undefined}
                  onOpenProfile={selectProfile}
                  {...controlsForMessage(message)}
                >
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
                <ApprovalCard
                  approval={approval}
                  onRespond={respondPermission}
                />
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
              running={Boolean(channel && controls.status === "running")}
              statusLabel={statusLabel}
              onOpen={() => {
                setBrowserOpen(false);
                setThreadRootId(null);
                setActivityOpen(true);
                onOpenInternalPanel?.();
              }}
            />
          </div>
        </div>
      </div>
      {browserOpen &&
      (browserBelongsToChat || browserInActiveChild) &&
      !profileOpen ? (
        <ConversationAuxiliaryPanel
          onClose={closeAuxiliaryWorkspace}
          sizing={panelSizing}
        >
          <ConversationAuxiliaryPanelHeader
            backLabel={
              activeChild
                ? `Back to ${activeChild.title}`
                : activeChildThreadRootId
                  ? "Back to thread"
                  : "Back"
            }
            onBack={returnFromBrowserPanel}
            title={
              <ConversationAuxiliaryBreadcrumb
                current="Browser"
                items={[
                  ...(activeChildThreadRootId
                    ? [
                        {
                          key: "thread",
                          label: "Thread",
                          onClick: returnToThread,
                        },
                      ]
                    : []),
                  ...(activeChild
                    ? [
                        {
                          key: "child",
                          label: activeChild.title,
                          onClick: () => setBrowserOpen(false),
                        },
                      ]
                    : []),
                ]}
              />
            }
            subtitle={
              browserPanelSession
                ? browserHostname(browserPanelSession.url)
                : undefined
            }
            onClose={returnFromBrowserPanel}
          />
          <ConversationAuxiliaryPanelBody className="overflow-hidden">
            <div
              ref={setBrowserPanelTarget}
              className="chief-browser-viewport-target h-full min-h-0 w-full overflow-hidden"
            />
          </ConversationAuxiliaryPanelBody>
        </ConversationAuxiliaryPanel>
      ) : activeChild && !profileOpen ? (
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
                items={[
                  ...(activeChildThreadRootId
                    ? [
                        {
                          key: "thread",
                          label: "Thread",
                          onClick: returnToThread,
                        },
                      ]
                    : []),
                ]}
              />
            }
            subtitle={`${taskAgentLabel(activeChild.agent)} · ${activeChild.status === "completed" ? "Complete" : activeChild.status === "running" || activeChild.status === "waiting" ? "Working" : activeChild.status}`}
            onClose={closeAuxiliaryWorkspace}
          />
          <ConversationAuxiliaryPanelBody className="overflow-hidden">
            <ObservedChat
              key={activeChild.id}
              chatId={activeChild.id}
              showHeader={false}
              inlineAttachment={
                browserInActiveChild ? (
                  <BrowserSessionAttachment
                    conversationId={activeChild.id}
                    detached={browserOpen}
                    operating={browserOperating}
                    onOpenPanel={openBrowserPanel}
                    targetRef={setBrowserInlineTarget}
                  />
                ) : undefined
              }
            />
          </ConversationAuxiliaryPanelBody>
        </ConversationAuxiliaryPanel>
      ) : channel && threadRootId && !activityOpen && !profileOpen ? (
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
          <ConversationAuxiliaryPanelBody className="space-y-2 px-4 py-4">
            {activeThreadRoot?.role === "user" ? (
              <div id={`chief-message-${activeThreadRoot.id}`}>
                <UserMessage
                  author={userAuthor}
                  attachments={imageParts(activeThreadRoot)}
                  metadata={null}
                  onOpenProfile={openUserProfile}
                  onOpenMention={openAgentMention}
                  text={messageBlocks(activeThreadRoot)
                    .flatMap((part) =>
                      part.type === "text" ? [part.text] : [],
                    )
                    .join("\n")}
                />
              </div>
            ) : null}
            {threadRootBrowserEntries.map((run) => (
              <div
                key={run.id}
                className="mx-auto w-full max-w-3xl min-w-0 pl-11"
              >
                <BrowserSessionAttachment
                  conversationId={chatId}
                  detached={
                    browserOpen &&
                    (run.id.startsWith("pending:") ||
                      run.id === chatBrowserSession?.runId)
                  }
                  operating={controls.status === "running"}
                  onOpenPanel={openBrowserPanel}
                  run={run}
                  targetRef={
                    run.id.startsWith("pending:") ||
                    run.id === chatBrowserSession?.runId
                      ? setBrowserInlineTarget
                      : undefined
                  }
                />
              </div>
            ))}
            <div className="my-3 flex items-center gap-2">
              <span className="bg-border h-px flex-1" />
              <span className="text-muted-foreground text-[10px]">
                {activeThreadSummary.count}{" "}
                {activeThreadSummary.count === 1 ? "reply" : "replies"}
              </span>
              <span className="bg-border h-px flex-1" />
            </div>
            {threadReplyEntries.map((entry) => {
              if (entry.type === "browser") {
                return (
                  <div
                    key={entry.key}
                    className="mx-auto w-full max-w-3xl min-w-0 pl-11"
                  >
                    <BrowserSessionAttachment
                      conversationId={chatId}
                      detached={
                        browserOpen &&
                        (entry.run?.id.startsWith("pending:") === true ||
                          entry.run?.id === chatBrowserSession?.runId)
                      }
                      operating={controls.status === "running"}
                      onOpenPanel={openBrowserPanel}
                      run={entry.run}
                      targetRef={
                        entry.run?.id.startsWith("pending:") ||
                        entry.run?.id === chatBrowserSession?.runId
                          ? setBrowserInlineTarget
                          : undefined
                      }
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
                      text={messageBlocks(message)
                        .flatMap((part) =>
                          part.type === "text" ? [part.text] : [],
                        )
                        .join("\n")}
                    />
                  </div>
                );
              }
              const blocks = channelVisibleBlocks(message);
              if (blocks.length === 0) return null;
              const specialistOnly = blocks.every(
                (block) => block.type === "tool_use",
              );
              if (specialistOnly) {
                return (
                  <div
                    key={message.id}
                    className="mx-auto w-full max-w-3xl pl-11"
                  >
                    <Blocks
                      blocks={blocks}
                      progress={controls.toolProgress}
                      capabilities={activeCapabilities}
                      active={controls.status === "running"}
                      tasks={childSessions}
                      taskOwners={childSessionOwners}
                      ownerId={message.id}
                      onOpenTask={onOpenChild}
                    />
                  </div>
                );
              }
              return (
                <ChiefMessage
                  key={message.id}
                  messageId={message.id}
                  agent={respondingAgentFor(message)}
                  metadata={null}
                  onOpenProfile={selectProfile}
                >
                  <Blocks
                    blocks={blocks}
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
            <div ref={threadBottomRef} />
          </ConversationAuxiliaryPanelBody>
          <div className="shrink-0 space-y-2 px-3 pb-3">
            <ChatComposer
              value={threadDraft}
              onValueChange={setThreadDraft}
              imageAttachments={threadImageAttachments}
              onImageAttachmentsChange={setThreadImageAttachments}
              onSubmit={() => {
                const text = threadDraft.trim();
                if (
                  (!text && threadImageAttachments.length === 0) ||
                  controls.status === "running"
                )
                  return;
                setThreadDraft("");
                setThreadImageAttachments([]);
                send(
                  text,
                  threadRootId,
                  activeThreadAudience,
                  threadImageAttachments,
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
        </ConversationAuxiliaryPanel>
      ) : null}
      {channel && activityOpen && !profileOpen && !activeChild ? (
        <AgentActivityPanel
          blocks={currentTurnBlocks}
          channelLabel={channel.label}
          progress={controls.toolProgress}
          running={controls.status === "running"}
          statusLabel={statusLabel}
          tasks={childSessions}
          onClose={() => setActivityOpen(false)}
          onOpenTask={onOpenChild}
          sizing={panelSizing}
        />
      ) : null}
      {browserPanelSession?.status === "active" ? (
        <BrowserSessionPortal
          conversationId={browserPanelConversationId}
          fullscreenTarget={
            browserOpen ? browserPanelTarget : browserInlineTarget
          }
          operating={browserOperating}
          onCloseViewer={browserOpen ? returnFromBrowserPanel : undefined}
          onOpenPanel={openBrowserPanel}
          panelOpen={browserOpen}
        />
      ) : null}
    </div>
  );
}
