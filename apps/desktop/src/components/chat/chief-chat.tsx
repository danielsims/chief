/* eslint-disable max-lines */

import type { ReactNode } from "react";
import {
  Fragment,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ArrowDown } from "lucide-react";

import type {
  AgentCapabilityId,
  BrowserRunRecord,
  ChatExecutionSelection,
  ChiefMessageMetadata,
  ChiefUIMessage,
  ContentBlock,
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
import { browserOpenResultContent } from "../../lib/browser-sessions";
import {
  channelMembershipTargetNames,
  formatMembershipTargets,
} from "../../lib/channel-actions";
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
import { approvalBelongsToSurface } from "./approval-presentation";
import { BrowserSessionAttachment } from "./browser-panel";
import { resolveBrowserRunAnchors } from "./browser-run-placement";
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
import { conversationActivityTurns } from "./conversation-activity-history";
import {
  ConversationAuxiliaryBreadcrumb,
  ConversationAuxiliaryPanel,
  ConversationAuxiliaryPanelBody,
  ConversationAuxiliaryPanelHeader,
} from "./conversation-auxiliary-panel";
import { conversationVisibleBlocks } from "./conversation-visible-blocks";
import { Blocks, SpecialistTaskCard } from "./message-blocks";
import { ObservedChat } from "./observed-chat";
import { QuestionCard } from "./question-card";
import { RecurringWorkComposer } from "./recurring-work-composer";
import {
  chronologicallyMergeSpecialistTasks,
  specialistTaskOwners,
} from "./specialist-task-display";
import { summarizeThreadReplyCandidates } from "./thread-reply-summary";
import { UserMessage } from "./user-message";

/**
 * Memoized per-message content. Thread rows are referentially stable after the
 * runtime merge, so unchanged messages skip re-rendering entirely instead of
 * rebuilding the whole thread on every stream/tool event — that rebuild is what
 * made opening a thread (especially one with a browser) janky and flickery.
 * progress is intentionally excluded: it only feeds tool cards, which no longer
 * render in the chat.
 */
const MessageBlocksContent = memo(
  function MessageBlocksContent({
    message,
    filter,
    progress,
    capabilities,
    active,
    tasks,
    taskOwners,
    ownerId,
    onOpenTask,
  }: {
    message: ChiefUIMessage;
    filter: (message: ChiefUIMessage) => ContentBlock[];
    progress?: Record<string, string>;
    capabilities?: readonly AgentCapabilityId[];
    active?: boolean;
    tasks?: readonly SessionRecord[];
    taskOwners?: ReadonlyMap<string, string>;
    ownerId?: string;
    onOpenTask?: (taskId: string) => void;
  }) {
    const blocks = useMemo(() => filter(message), [filter, message]);
    return (
      <Blocks
        blocks={blocks}
        progress={progress}
        capabilities={capabilities}
        active={active}
        tasks={tasks}
        taskOwners={taskOwners}
        ownerId={ownerId}
        onOpenTask={onOpenTask}
      />
    );
  },
  (prev, next) => {
    if (prev.message !== next.message) return false;
    if (prev.filter !== next.filter) return false;
    if (prev.active !== next.active) return false;
    if (prev.capabilities !== next.capabilities) return false;
    if (prev.ownerId !== next.ownerId) return false;
    if (prev.tasks !== next.tasks) return false;
    if (prev.taskOwners !== next.taskOwners) return false;
    if (prev.onOpenTask !== next.onOpenTask) return false;
    return true;
  },
);

/** Muted, Slack-like skeleton shown while a channel's content resolves. */
function ChatSkeleton() {
  return (
    <div
      aria-hidden
      className="mx-auto w-full max-w-3xl space-y-6 py-2"
      data-testid="chat-skeleton"
    >
      {[0, 1, 2, 3].map((row) => (
        <div key={row} className="flex items-start gap-3">
          <div className="bg-muted/60 size-8 shrink-0 animate-pulse rounded-full" />
          <div className="min-w-0 flex-1 space-y-2 pt-1.5">
            <div className="bg-muted/60 h-2.5 w-40 animate-pulse rounded-md" />
            <div className="bg-muted/60 h-2.5 w-full animate-pulse rounded-md" />
            <div className="bg-muted/40 h-2.5 w-3/4 animate-pulse rounded-md" />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * True only for the tool call that OPENS the browser session. Interactions
 * (snapshot, click, fill, select, press) operate on an already-open browser
 * and must not render a second attachment — otherwise a turn with several
 * browser steps renders one placeholder container per step, with the live
 * viewer only attached to the last.
 */
function isBrowserOpenBlock(block: ContentBlock): boolean {
  if (block.type !== "tool_use") return false;
  const name = block.name.toLowerCase();
  if (
    name === "browser.open" ||
    name === "googleoauth.provisionclient" ||
    name === "googleanalytics.authorize"
  ) {
    return true;
  }
  const code = browserToolCode(block.input);
  return (
    code !== null &&
    (code.includes("browserOpen") ||
      code.includes("browser.open") ||
      code.includes("googleOAuthProvisionClient") ||
      code.includes("googleOAuth.provisionClient") ||
      code.includes("googleAnalyticsAuthorize"))
  );
}

/**
 * The browser-open tool_use block of a message, if any. The input-based check
 * is supplemented by the paired tool result so the executor's `executor_execute`
 * browserOpen call (empty persisted input, `{ opened: true, url }` output) is
 * recognized.
 */
function browserOpenBlockIn(
  blocks: ContentBlock[],
): Extract<ContentBlock, { type: "tool_use" }> | undefined {
  const results = new Map(
    blocks
      .filter(
        (block): block is Extract<ContentBlock, { type: "tool_result" }> =>
          block.type === "tool_result",
      )
      .map((block) => [block.tool_use_id, block]),
  );
  return blocks.find(
    (block): block is Extract<ContentBlock, { type: "tool_use" }> =>
      block.type === "tool_use" &&
      (isBrowserOpenBlock(block) ||
        Boolean(
          results.get(block.id) &&
          browserOpenResultContent(results.get(block.id)?.content),
        )),
  );
}

function browserToolCode(input: unknown): string | null {
  if (!input || typeof input !== "object") return null;
  const candidate = (input as Record<string, unknown>).code;
  if (typeof candidate === "string") {
    if (candidate.includes("tools.") || candidate.includes('tools["')) {
      return candidate;
    }
    return null;
  }
  if (candidate && typeof candidate === "object") {
    const nested = browserToolCode(candidate);
    if (nested !== null) return nested;
  }
  for (const value of Object.values(input as Record<string, unknown>)) {
    if (typeof value !== "string") continue;
    if (value.includes("tools.") || value.includes('tools["')) return value;
    const nested = browserToolCode(value);
    if (nested !== null) return nested;
  }
  return null;
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
  const targetNames = channelMembershipTargetNames(action, (agentId) => {
    if (!Object.hasOwn(WORKSPACE_AGENT_IDENTITIES, agentId)) return agentId;
    return WORKSPACE_AGENT_IDENTITIES[agentId as WorkspaceAgentId].name;
  });
  const actorIsAgent = action.actorType === "agent";
  return (
    <div className="text-muted-foreground mx-auto flex w-full max-w-3xl items-center gap-2.5 py-2 pl-11 text-xs">
      {actorIsAgent ? (
        <AgentAvatar
          className="size-5"
          markClassName="size-2.5"
          label={action.actorName}
        />
      ) : (
        <span className="bg-muted flex size-5 shrink-0 items-center justify-center overflow-hidden rounded-full text-[8px] font-semibold">
          {userImage ? (
            <img src={userImage} alt="" className="size-full object-cover" />
          ) : (
            action.actorName.charAt(0).toUpperCase()
          )}
        </span>
      )}
      <span>
        <strong className="text-foreground font-medium">
          {action.actorName}
        </strong>{" "}
        added{" "}
        <strong className="text-foreground font-medium">
          {formatMembershipTargets(targetNames)}
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
  integrationDomain?: string;
  activeChild?: SessionRecord;
  onInitialPromptSent?: () => void;
  onCloseChild?: () => void;
  onOpenChild?: (childId: string) => void;
  onOpenProfile?: (selection: ConversationProfileSelection) => void;
  onOpenInternalPanel?: () => void;
  activityOpen: boolean;
  onActivityOpenChange: (open: boolean) => void;
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
  const initialExecution = resolved.driver
    ? { driver: resolved.driver, model: resolved.model }
    : initialDriver
      ? { driver: initialDriver, model: initialModel }
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
    channelResolved,
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
      integrationDomain,
    },
  );
  const setActivityOpen = onActivityOpenChange;
  const activityAgentLabel = directAgent?.name ?? "Chief";
  const currentTurn = useMemo(
    () =>
      channelActivityState(
        messages,
        controls.hasAgentOutput,
        activityAgentLabel,
      ),
    [activityAgentLabel, controls.hasAgentOutput, messages],
  );
  const currentTurnBlocks = currentTurn.blocks;
  const activityTurns = useMemo(
    () =>
      conversationActivityTurns(
        messages.flatMap((message) =>
          message.role === "assistant" || message.role === "user"
            ? [
                {
                  id: message.id,
                  role: message.role,
                  createdAt: message.metadata?.createdAt,
                  blocks: withoutMarkerLines(messageBlocks(message)),
                },
              ]
            : [],
        ),
      ),
    [messages],
  );
  const currentActivityTurnId = activityTurns.at(-1)?.id;
  const previousActivityTurns = useMemo(
    () =>
      activityTurns
        .filter(
          (turn) =>
            turn.id !== currentActivityTurnId &&
            turn.blocks.some((block) => block.type === "tool_use"),
        )
        .reverse(),
    [activityTurns, currentActivityTurnId],
  );
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
    interruptActive = false,
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
        interruptActive,
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
  const mainScrollRef = useRef<HTMLDivElement>(null);
  const threadScrollRef = useRef<HTMLDivElement>(null);
  const mainHasEnteredRef = useRef(false);
  const threadHasEnteredRef = useRef(false);
  const sentInitial = useRef(false);

  useEffect(() => {
    mainHasEnteredRef.current = false;
    threadHasEnteredRef.current = false;
  }, [chatId]);

  const [mainScrolledUp, setMainScrolledUp] = useState(false);
  useEffect(() => {
    const container = mainScrollRef.current;
    if (!container) return;
    const onScroll = () => {
      const nearBottom =
        container.scrollHeight - container.scrollTop - container.clientHeight <
        120;
      setMainScrolledUp(!nearBottom);
    };
    container.addEventListener("scroll", onScroll, { passive: true });
    return () => container.removeEventListener("scroll", onScroll);
  }, []);

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
    const container = mainScrollRef.current;
    if (!container || (!channelResolved && !isNew)) return;
    // Entering a channel snaps to the bottom with zero animation. After that,
    // follow new messages with the same snap, but only while the user is still
    // near the bottom — never yank them if they scrolled up (a floating button
    // offers the smooth scroll instead).
    if (!mainHasEnteredRef.current) {
      mainHasEnteredRef.current = true;
      container.scrollTop = container.scrollHeight;
      return;
    }
    const nearBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight <
      120;
    if (nearBottom) {
      container.scrollTop = container.scrollHeight;
    }
  }, [
    channelResolved,
    childSessions.length,
    initialMessageId,
    isNew,
    messages.length,
  ]);

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
    if (!driver || !chatReady) return;
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
    // Sending a follow-up is one atomic preemption request. The runtime records
    // the message immediately, interrupts the active turn, then continues with
    // this updated conversation. There is no hidden queue or steering draft.
    send(text, undefined, [], imageAttachments, controls.status === "running");
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
  const childSessionOwners = useMemo(
    () =>
      specialistTaskOwners(
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
      ),
    [childSessions, messages],
  );
  const mainTimelineChildSessions = useMemo(
    () =>
      childSessions.filter((task) => {
        const ownerId = childSessionOwners.get(task.id);
        if (!ownerId) return true;
        const owner = messages.find((message) => message.id === ownerId);
        return !owner?.metadata?.threadRootId;
      }),
    [childSessionOwners, childSessions, messages],
  );
  const activeThreadChildSessions = useMemo(
    () =>
      threadRootId
        ? childSessions.filter((task) => {
            const ownerId = childSessionOwners.get(task.id);
            if (!ownerId) return false;
            return (
              messages.find((message) => message.id === ownerId)?.metadata
                ?.threadRootId === threadRootId
            );
          })
        : [],
    [childSessionOwners, childSessions, messages, threadRootId],
  );
  const activeChildOwnerId = activeChild
    ? childSessionOwners.get(activeChild.id)
    : undefined;
  const activeChildOwner = activeChildOwnerId
    ? messages.find((message) => message.id === activeChildOwnerId)
    : undefined;
  const activeChildThreadRootId =
    activeChildOwner?.metadata?.threadRootId ?? threadRootId;
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
    const container = threadScrollRef.current;
    if (container && !threadHasEnteredRef.current) {
      threadHasEnteredRef.current = true;
      container.scrollTop = container.scrollHeight;
      return;
    }
    // Follow new replies with the same zero-animation snap, never yanking the
    // user if they scrolled up inside the thread.
    if (container) {
      const nearBottom =
        container.scrollHeight - container.scrollTop - container.clientHeight <
        120;
      if (nearBottom) container.scrollTop = container.scrollHeight;
    }
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
  const chatBrowserRuns = useMemo(
    () =>
      browserRuns
        .filter(
          (run) =>
            run.workspaceId === cloudOrganizationId &&
            run.conversationId === chatId,
        )
        .sort(
          (left, right) =>
            left.createdAt - right.createdAt || left.id.localeCompare(right.id),
        ),
    [browserRuns, chatId, cloudOrganizationId],
  );
  const browserAnchorCandidates = useMemo(
    () =>
      messages.map((message) => ({
        id: message.id,
        role: message.role,
        threadRootId: message.metadata?.threadRootId ?? null,
        isBrowserOpen: browserOpenBlockIn(messageBlocks(message)) !== undefined,
        createdAt: message.metadata?.createdAt,
      })),
    [messages],
  );
  const liveBrowserAnchors = useMemo(
    () =>
      Object.fromEntries(
        chatBrowserRuns.map((run) => [
          run.id,
          browserSessions[run.id]?.anchorMessageId ?? null,
        ]),
      ),
    [browserSessions, chatBrowserRuns],
  );
  const browserRunAnchors = useMemo(
    () =>
      resolveBrowserRunAnchors(
        chatBrowserRuns,
        browserAnchorCandidates,
        liveBrowserAnchors,
      ),
    [browserAnchorCandidates, chatBrowserRuns, liveBrowserAnchors],
  );
  const childBrowserRun = activeChild
    ? browserRuns
        .filter(
          (run) =>
            run.workspaceId === cloudOrganizationId &&
            run.conversationId === activeChild.id &&
            browserSessions[run.id]?.status === "active",
        )
        .at(-1)
    : undefined;
  const browserInActiveChild = Boolean(childBrowserRun);
  const browserOperating = browserInActiveChild
    ? activeChild?.status === "running" || activeChild?.status === "waiting"
    : controls.status === "running";
  const anchoredBrowserRunIdsRef = useRef(new Set<string>());
  useEffect(() => {
    for (const run of chatBrowserRuns) {
      const session = browserSessions[run.id];
      const anchor = browserRunAnchors.get(run.id);
      if (
        !anchor ||
        (run.anchorMessageId === anchor &&
          (!session || session.anchorMessageId === anchor)) ||
        anchoredBrowserRunIdsRef.current.has(run.id)
      ) {
        continue;
      }
      anchoredBrowserRunIdsRef.current.add(run.id);
      anchorBrowserSession(run.id, anchor);
    }
  }, [
    anchorBrowserSession,
    browserRunAnchors,
    browserSessions,
    chatBrowserRuns,
  ]);
  const browserAttachmentNode = (run: BrowserRunRecord) => (
    <div className="mx-auto w-full max-w-3xl py-1 pl-11">
      <BrowserSessionAttachment
        operating={controls.status === "running"}
        run={run}
      />
    </div>
  );
  const timelineEntries = useMemo(() => {
    const entries: (
      | { type: "message"; message: ChiefUIMessage }
      | { type: "browser"; key: string; run: BrowserRunRecord }
      | { type: "specialist"; task: SessionRecord }
    )[] = [];
    const placed = new Set<string>();
    for (const entry of chronologicallyMergeSpecialistTasks(
      messages,
      mainTimelineChildSessions,
    )) {
      if (entry.type === "specialist") {
        entries.push(entry);
        continue;
      }
      const { message } = entry;
      entries.push({ type: "message", message });
      for (const run of chatBrowserRuns) {
        if (run.threadRootId || browserRunAnchors.get(run.id) !== message.id)
          continue;
        entries.push({ type: "browser", key: `browser:${run.id}`, run });
        placed.add(run.id);
      }
    }
    for (const run of chatBrowserRuns) {
      if (!run.threadRootId && !placed.has(run.id)) {
        entries.push({ type: "browser", key: `browser:end:${run.id}`, run });
      }
    }
    return entries;
  }, [browserRunAnchors, chatBrowserRuns, mainTimelineChildSessions, messages]);
  const threadReplyEntries = useMemo(() => {
    const entries: (
      | { type: "message"; message: ChiefUIMessage }
      | { type: "browser"; key: string; run: BrowserRunRecord }
      | { type: "specialist"; task: SessionRecord }
    )[] = [];
    const placed = new Set<string>();
    for (const entry of chronologicallyMergeSpecialistTasks(
      activeThreadReplies,
      activeThreadChildSessions,
    )) {
      if (entry.type === "specialist") {
        entries.push(entry);
        continue;
      }
      const { message } = entry;
      entries.push({ type: "message", message });
      for (const run of chatBrowserRuns) {
        if (
          run.threadRootId !== threadRootId ||
          browserRunAnchors.get(run.id) !== message.id
        ) {
          continue;
        }
        entries.push({ type: "browser", key: `browser:${run.id}`, run });
        placed.add(run.id);
      }
    }
    for (const run of chatBrowserRuns) {
      if (run.threadRootId === threadRootId && !placed.has(run.id)) {
        entries.push({ type: "browser", key: `browser:end:${run.id}`, run });
      }
    }
    return entries;
  }, [
    activeThreadChildSessions,
    activeThreadReplies,
    browserRunAnchors,
    chatBrowserRuns,
    threadRootId,
  ]);
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
  const visibleConversationBlocks = useCallback(
    (message: ChiefUIMessage) =>
      conversationVisibleBlocks(withoutMarkerLines(messageBlocks(message))),
    [],
  );
  // The chat is a conversation, not an agent runtime: ordinary tool calls (Run
  // connected tool, skill loads, browser commands) do not render as cards here.
  // Their detail lives in the activity panel, and the embedded browser shows
  // what the agent is doing through its own operating labels. Specialist
  // sessions render directly from durable activity below, so their visibility
  // never depends on retaining a provider-specific delegation tool call.
  const threadBlocks = visibleConversationBlocks;
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
  const acknowledgedDmMessageId = useMemo(() => {
    if (channel || controls.status !== "running") return undefined;
    let userIndex = messages.length - 1;
    while (
      userIndex >= 0 &&
      (messages[userIndex]?.role !== "user" ||
        messages[userIndex]?.metadata?.threadRootId)
    ) {
      userIndex -= 1;
    }
    if (userIndex < 0) return undefined;
    const visibleReplyStarted = messages
      .slice(userIndex + 1)
      .some(
        (message) =>
          message.role === "assistant" &&
          !message.metadata?.threadRootId &&
          visibleConversationBlocks(message).length > 0,
      );
    return visibleReplyStarted ? undefined : messages[userIndex]?.id;
  }, [channel, controls.status, messages, visibleConversationBlocks]);

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
      {activeChild && !profileOpen ? (
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
            subtitle={`${taskAgentLabel(activeChild.agent)} · ${activeChild.status === "completed" ? "Complete" : activeChild.status === "idle" ? "Starting" : activeChild.status === "running" || activeChild.status === "waiting" ? "Working" : activeChild.status}`}
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
                  text={messageBlocks(activeThreadRoot)
                    .flatMap((part) =>
                      part.type === "text" ? [part.text] : [],
                    )
                    .join("\n")}
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
                      text={messageBlocks(message)
                        .flatMap((part) =>
                          part.type === "text" ? [part.text] : [],
                        )
                        .join("\n")}
                    />
                  </div>
                );
              }
              const blocks = threadBlocks(message);
              if (blocks.length === 0) return null;
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
            {threadRootId
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
      ) : null}
      {activityOpen && !profileOpen && !activeChild ? (
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
      ) : null}
    </div>
  );
}
