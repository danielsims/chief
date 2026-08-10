import { useEffect, useRef, useState } from "react";

import type { WorkspaceAgentId } from "../../lib/workspace-channels";
import type { ChiefChatProps } from "./chief-chat-types";
import type { ComposerImageAttachment } from "./composer-image-attachments";
import type { ConversationProfileSelection } from "./conversation-profile";
import type { SchedulingDraft } from "./recurring-work-composer";
import type { useChiefChatCore } from "./use-chief-chat-core";

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
    | "isNew"
    | "onInitialPromptSent"
    | "onOpenProfile"
  >;
}) {
  const {
    channelResolved,
    chatReady,
    childSessions,
    controls,
    driver,
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
    isNew,
    onInitialPromptSent,
    onOpenProfile,
  } = props;
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
    if (!mainHasEnteredRef.current) {
      mainHasEnteredRef.current = true;
      container.scrollTop = container.scrollHeight;
      return;
    }
    const nearBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight <
      120;
    if (nearBottom) container.scrollTop = container.scrollHeight;
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
      const timer = setTimeout(() => {
        if (sentInitial.current) return;
        sentInitial.current = true;
        send(initialPrompt ?? "", undefined, [], initialAttachments);
        onInitialPromptSent?.();
      }, 400);
      return () => clearTimeout(timer);
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
    mainScrolledUp,
    mainScrollRef,
    openAgentMention,
    openUserProfile,
    optimisticInitialPrompt,
    selectProfile,
    setComposerOpen,
    setDraft,
    setImageAttachments,
    setThreadDraft,
    setThreadImageAttachments,
    setThreadRootId,
    submit,
    suppressThreadAutoScrollRef,
    threadBottomRef,
    threadDraft,
    threadHasEnteredRef,
    threadImageAttachments,
    threadRootId,
    threadScrollRef,
  };
}
