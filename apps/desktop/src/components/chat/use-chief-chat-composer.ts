import {
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react";

import type { ChiefUIMessage } from "@chief/agent-runtime/types";

import type { WorkspaceAgentId } from "../../lib/workspace-channels";
import type { ChiefChatProps } from "./chief-chat-types";
import type { ComposerImageAttachment } from "./composer-image-attachments";
import type { ConversationProfileSelection } from "./conversation-profile";
import type { SchedulingDraft } from "./recurring-work-composer";
import type { useChiefChatCore } from "./use-chief-chat-core";
import { useConversationScroll } from "./use-stick-to-bottom";

type Core = ReturnType<typeof useChiefChatCore>;

/**
 * Owns transient conversation interaction state: drafts, attachments, thread
 * selection, composer submission, profile navigation, and scroll refs. It uses
 * the core hook for runtime operations and leaves message ordering to timeline.
 */
export function useChiefChatComposer({
  core,
  props,
}: {
  core: Core;
  props: Pick<
    ChiefChatProps,
    | "chatId"
    | "composer"
    | "initialAttachments"
    | "initialDraft"
    | "initialMessageId"
    | "initialPrompt"
    | "initialThreadRootId"
    | "onInitialPromptSent"
    | "onOpenProfile"
    | "onThreadRootChange"
  >;
}) {
  const {
    chatReady,
    controls,
    messages,
    runtimeStatus,
    send,
    setActivityOpen,
    workspaceData,
  } = core;
  const {
    chatId,
    composer,
    initialAttachments = [],
    initialDraft,
    initialMessageId,
    initialPrompt,
    initialThreadRootId,
    onInitialPromptSent,
    onOpenProfile,
    onThreadRootChange,
  } = props;
  const [draft, setDraft] = useState(initialDraft ?? "");
  const [threadDraft, setThreadDraft] = useState("");
  const [imageAttachments, setImageAttachments] = useState<
    ComposerImageAttachment[]
  >([]);
  const [threadImageAttachments, setThreadImageAttachments] = useState<
    ComposerImageAttachment[]
  >([]);
  const [localThreadRootId, setLocalThreadRootId] = useState<string | null>(
    initialThreadRootId ?? null,
  );
  const threadRootId = onThreadRootChange
    ? (initialThreadRootId ?? null)
    : localThreadRootId;
  const setThreadRootId = useCallback(
    (nextThreadRootId: string | null) => {
      if (onThreadRootChange) onThreadRootChange(nextThreadRootId);
      else setLocalThreadRootId(nextThreadRootId);
    },
    [onThreadRootChange],
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
  const openAuthorProfile = (message: ChiefUIMessage) =>
    onOpenProfile
      ? () =>
          selectProfile({
            kind: "user",
            ...(message.metadata?.author
              ? { userId: message.metadata.author.id }
              : undefined),
          })
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
  const approveRecurringWork = useEffectEvent(
    (proposed: (typeof workspaceData.recurringWork)[number]) => {
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
    },
  );
  const sendInitialPrompt = useEffectEvent(() => {
    sentInitial.current = true;
    send(initialPrompt ?? "", undefined, [], initialAttachments);
    onInitialPromptSent?.();
  });

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
    approveRecurringWork(proposed);
  }, [workspaceData.recurringWork]);

  // A conversation or thread opened to show one message stays on it.
  const main = useConversationScroll(
    chatId,
    () => !suppressMainAutoScrollRef.current,
  );
  const thread = useConversationScroll(
    threadRootId,
    () => !suppressThreadAutoScrollRef.current,
  );

  useEffect(() => {
    if (
      (initialPrompt !== undefined || initialAttachments.length > 0) &&
      !sentInitial.current &&
      chatReady &&
      runtimeStatus === "connected"
    ) {
      const timer = setTimeout(() => {
        if (sentInitial.current) return;
        sendInitialPrompt();
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [initialPrompt, initialAttachments, runtimeStatus, chatReady]);

  const submit = () => {
    if (!chatReady) return;
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
    send(text, undefined, [], imageAttachments, controls.status === "running");
  };
  const composeSchedule = ({
    text,
    approveAfterCreation: nextApproval,
  }: SchedulingDraft) => {
    setDraft(text);
    setApproveAfterCreation(nextApproval);
  };

  return {
    bottomRef,
    composeSchedule,
    composerOpen,
    draft,
    imageAttachments,
    mainContentRef: main.contentRef,
    mainScrolledUp: !main.isAtBottom,
    mainScrollRef: main.scrollRef,
    scrollMainToBottom: main.scrollToBottom,
    openAgentMention,
    openUserProfile,
    openAuthorProfile,
    optimisticInitialPrompt,
    selectProfile,
    setComposerOpen,
    setDraft,
    setImageAttachments,
    setThreadDraft,
    setThreadImageAttachments,
    setThreadRootId,
    submit,
    threadBottomRef,
    threadContentRef: thread.contentRef,
    threadDraft,
    threadImageAttachments,
    threadRootId,
    threadScrollRef: thread.scrollRef,
  };
}
