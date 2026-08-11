import type { RefObject } from "react";
import { useEffect, useMemo, useRef } from "react";

import type {
  BrowserRunRecord,
  ChiefUIMessage,
  SessionRecord,
} from "@chief/agent-runtime/types";

import type { useChannelReadState } from "../../lib/channel-read-state-context";
import type { useRuntime } from "../../lib/runtime";
import {
  browserRunBelongsToChat,
  projectBrowserRunToOwnedThread,
} from "../../lib/browser-sessions";
import { withoutMarkerLines } from "../../lib/integration-setup";
import { messageBlocks } from "../../lib/runtime";
import { resolveBrowserRunAnchors } from "./browser-run-placement";
import { threadAgentAudience } from "./channel-thread-audience";
import { browserOpenBlockIn } from "./chief-chat-message-components";
import {
  chronologicallyMergeSpecialistTasks,
  specialistTaskOwners,
} from "./specialist-task-display";

type TimelineEntry =
  | { type: "message"; message: ChiefUIMessage }
  | { type: "browser"; key: string; run: BrowserRunRecord }
  | { type: "specialist"; task: SessionRecord };

type ReadState = ReturnType<typeof useChannelReadState>;
type Runtime = ReturnType<typeof useRuntime>;

/**
 * Derives the ordered main and thread timelines from messages, specialist
 * tasks, and browser runs. It also owns thread read tracking and durable browser
 * anchoring, but does not send messages or render conversation controls.
 */
export function useChiefChatTimeline({
  activeChild,
  anchorBrowserSession,
  browserRuns,
  browserSessions,
  channel,
  chatId,
  childSessions,
  cloudOrganizationId,
  controlsStatus,
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
}: {
  activeChild?: SessionRecord;
  anchorBrowserSession: Runtime["anchorBrowserSession"];
  browserRuns: Runtime["browserRuns"];
  browserSessions: Runtime["browserSessions"];
  channel?: { label: string; description: string; agentIds: readonly string[] };
  chatId: string;
  childSessions: readonly SessionRecord[];
  cloudOrganizationId: string | null;
  controlsStatus: string;
  destinationChannelId?: string;
  initialMessageId?: string;
  knownAgentIds: ReadonlySet<string>;
  markThreadRead: ReadState["markThreadRead"];
  messages: readonly ChiefUIMessage[];
  optimisticInitialPrompt: string | null;
  setVisibleThread: ReadState["setVisibleThread"];
  suppressThreadAutoScrollRef: RefObject<boolean>;
  threadHasEnteredRef: RefObject<boolean>;
  threadRootId: string | null;
  threadScrollRef: RefObject<HTMLDivElement | null>;
}) {
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
        if (typeof task.triggerContext?.threadRootId === "string") return false;
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
            if (task.triggerContext?.threadRootId === threadRootId) return true;
            if (task.triggerContext?.originThreadRootId === threadRootId)
              return true;
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
  const activeSpecialistByThread = useMemo(() => {
    const specialists = new Map<string, SessionRecord>();
    for (const task of childSessions) {
      const rootIds = [
        task.triggerContext?.threadRootId,
        task.triggerContext?.originThreadRootId,
      ];
      for (const rootId of rootIds) {
        if (typeof rootId !== "string") continue;
        const current = specialists.get(rootId);
        if (!current || task.updatedAt >= current.updatedAt) {
          specialists.set(rootId, task);
        }
      }
    }
    return specialists;
  }, [childSessions]);
  const activeChildOwnerId = activeChild
    ? childSessionOwners.get(activeChild.id)
    : undefined;
  const activeChildOwner = activeChildOwnerId
    ? messages.find((message) => message.id === activeChildOwnerId)
    : undefined;
  const activeChildThreadRootId =
    (typeof activeChild?.triggerContext?.threadRootId === "string"
      ? activeChild.triggerContext.threadRootId
      : activeChildOwner?.metadata?.threadRootId) ?? threadRootId;
  const threadReplies = useMemo(() => {
    const replies = new Map<string, ChiefUIMessage[]>();
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
    if (container) {
      const nearBottom =
        container.scrollHeight - container.scrollTop - container.clientHeight <
        120;
      if (nearBottom) container.scrollTop = container.scrollHeight;
    }
  }, [
    activeThreadReplies.length,
    initialMessageId,
    suppressThreadAutoScrollRef,
    threadHasEnteredRef,
    threadRootId,
    threadScrollRef,
  ]);
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
  const chatBrowserRuns = useMemo(() => {
    const childSessionIds = new Set(
      childSessions
        .filter((task) => task.parentId === chatId)
        .map((task) => task.id),
    );
    return browserRuns
      .filter(
        (run) =>
          run.workspaceId === cloudOrganizationId &&
          browserRunBelongsToChat(run, chatId, childSessionIds),
      )
      .sort(
        (left, right) =>
          left.createdAt - right.createdAt || left.id.localeCompare(right.id),
      );
  }, [browserRuns, chatId, childSessions, cloudOrganizationId]);
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
    : controlsStatus === "running";
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

  const timelineEntries = useMemo(
    () =>
      mergeTimelineEntries(
        messages,
        mainTimelineChildSessions,
        chatBrowserRuns,
        browserRunAnchors,
        null,
      ),
    [browserRunAnchors, chatBrowserRuns, mainTimelineChildSessions, messages],
  );
  const activeThreadBrowserRuns = useMemo(() => {
    const childSessionIds = new Set(
      activeThreadChildSessions.map((task) => task.id),
    );
    return chatBrowserRuns.map((run) =>
      projectBrowserRunToOwnedThread(run, threadRootId, childSessionIds),
    );
  }, [activeThreadChildSessions, chatBrowserRuns, threadRootId]);
  const threadReplyEntries = useMemo(
    () =>
      mergeTimelineEntries(
        activeThreadReplies,
        activeThreadChildSessions,
        activeThreadBrowserRuns,
        browserRunAnchors,
        threadRootId,
      ),
    [
      activeThreadChildSessions,
      activeThreadReplies,
      activeThreadBrowserRuns,
      browserRunAnchors,
      threadRootId,
    ],
  );

  return {
    activeSpecialistByThread,
    activeChildThreadRootId,
    activeThreadAudience,
    activeThreadReplies,
    activeThreadRoot,
    browserOperating,
    browserRunAnchors,
    chatBrowserRuns,
    childBrowserRun,
    childSessionOwners,
    showOptimisticInitialPrompt,
    threadReplies,
    threadReplyEntries,
    timelineEntries,
  };
}

function mergeTimelineEntries(
  messages: readonly ChiefUIMessage[],
  tasks: readonly SessionRecord[],
  runs: readonly BrowserRunRecord[],
  anchors: ReadonlyMap<string, string>,
  threadRootId: string | null,
): TimelineEntry[] {
  const entries: TimelineEntry[] = [];
  const placed = new Set<string>();
  for (const entry of chronologicallyMergeSpecialistTasks(messages, tasks)) {
    if (entry.type === "specialist") {
      entries.push(entry);
      continue;
    }
    entries.push({ type: "message", message: entry.message });
    for (const run of runs) {
      if (
        (run.threadRootId ?? null) !== threadRootId ||
        anchors.get(run.id) !== entry.message.id
      ) {
        continue;
      }
      entries.push({ type: "browser", key: `browser:${run.id}`, run });
      placed.add(run.id);
    }
  }
  for (const run of runs) {
    if ((run.threadRootId ?? null) === threadRootId && !placed.has(run.id)) {
      entries.push({ type: "browser", key: `browser:${run.id}`, run });
    }
  }
  return entries;
}
