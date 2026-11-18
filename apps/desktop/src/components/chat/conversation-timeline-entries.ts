import type {
  BrowserRunRecord,
  ChiefUIMessage,
  SessionRecord,
} from "@chief/agent-runtime/types";

import type { MessageSource } from "./message-sources";
import type { SessionChange } from "./session-work";
import { messageFileEdits } from "./message-changes";
import { mergeSources, messagePageReads } from "./message-sources";

export type TimelineEntry =
  | {
      type: "message";
      message: ChiefUIMessage;
      /** Pages the agent read on its way to this reply. */
      sources?: readonly MessageSource[];
      /** File edits the agent made on its way to this reply. */
      changes?: readonly SessionChange[];
    }
  | { type: "browser"; key: string; run: BrowserRunRecord }
  | { type: "specialist"; task: SessionRecord };

function isActivityProjection(message: ChiefUIMessage) {
  if (message.role !== "assistant") return false;
  const text = message.parts
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("")
    .trim();
  return (
    !text &&
    message.parts.some(
      (part) => part.type === "reasoning" || part.type === "dynamic-tool",
    )
  );
}

/** Base conversation entries contain authored messages and rich browser
 * handoffs. Public specialist summaries are projected separately. */
export function conversationTimelineEntries(
  messages: readonly ChiefUIMessage[],
  runs: readonly BrowserRunRecord[],
  anchors: ReadonlyMap<string, string>,
  threadRootId: string | null,
): TimelineEntry[] {
  const entries: TimelineEntry[] = [];
  const placed = new Set<string>();
  // Pages read and files edited by each agent since its last reply, credited
  // to the next one.
  const reading = new Map<string, readonly MessageSource[]>();
  const editing = new Map<string, readonly SessionChange[]>();
  for (const message of messages) {
    if ((message.metadata?.threadRootId ?? null) !== threadRootId) continue;
    const agentId = message.metadata?.agentId ?? "";
    if (isActivityProjection(message)) {
      const reads = messagePageReads(message);
      if (reads.length > 0)
        reading.set(agentId, mergeSources(reading.get(agentId) ?? [], reads));
      const edits = messageFileEdits(message);
      if (edits.length > 0)
        editing.set(agentId, [...(editing.get(agentId) ?? []), ...edits]);
    } else if (message.role === "assistant") {
      entries.push({
        type: "message",
        message,
        sources: reading.get(agentId),
        changes: editing.get(agentId),
      });
      reading.delete(agentId);
      editing.delete(agentId);
    } else {
      entries.push({ type: "message", message });
    }
    for (const run of runs) {
      if (
        (run.threadRootId ?? null) !== threadRootId ||
        anchors.get(run.id) !== message.id
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

export function timelineEntryCreatedAt(entry: TimelineEntry) {
  if (entry.type === "message") return entry.message.metadata?.createdAt;
  if (entry.type === "browser") return entry.run.createdAt;
  return entry.task.createdAt;
}

/**
 * Projects a specialist execution into its owning thread without exposing the
 * private run transcript. The task card remains after completion or failure
 * and opens the task's Activity view.
 */
export function withSpecialistTimelineEntries(
  entries: readonly TimelineEntry[],
  tasks: readonly SessionRecord[],
): TimelineEntry[] {
  const result = [...entries];
  const orderedTasks = [...tasks].sort(
    (left, right) =>
      left.createdAt - right.createdAt || left.id.localeCompare(right.id),
  );
  for (const task of orderedTasks) {
    const insertionIndex = result.findIndex((entry) => {
      const createdAt = timelineEntryCreatedAt(entry);
      return createdAt !== undefined && createdAt > task.createdAt;
    });
    const taskEntry: TimelineEntry = { type: "specialist", task };
    if (insertionIndex < 0) result.push(taskEntry);
    else result.splice(insertionIndex, 0, taskEntry);
  }
  return result;
}

/** Consecutive messages from one person within this window share a header. */
const MESSAGE_GROUPING_WINDOW_MS = 5 * 60 * 1000;

function personKey(message: ChiefUIMessage, currentUserId: string | undefined) {
  if (message.role !== "user") return null;
  const metadata = message.metadata;
  if (metadata?.channelAction || metadata?.scheduledRun) return null;
  const authorId = metadata?.author?.id;
  return !authorId || authorId === currentUserId ? "self" : `user:${authorId}`;
}

/**
 * Ids of people's messages that continue the previous message's author, on
 * the same day and within five minutes, so they render without the avatar and
 * name. Matches the mobile transcript.
 */
export function continuedMessageIds(
  entries: readonly TimelineEntry[],
  currentUserId: string | undefined,
) {
  const continued = new Set<string>();
  let previousKey: string | null = null;
  let previousAt: number | undefined;
  for (const entry of entries) {
    // Specialist cards render in their thread, not between messages.
    if (entry.type === "specialist") continue;
    if (entry.type !== "message") {
      previousKey = null;
      continue;
    }
    const key = personKey(entry.message, currentUserId);
    const createdAt = entry.message.metadata?.createdAt;
    if (
      key &&
      previousKey === key &&
      createdAt !== undefined &&
      previousAt !== undefined &&
      createdAt - previousAt <= MESSAGE_GROUPING_WINDOW_MS &&
      new Date(createdAt).toDateString() === new Date(previousAt).toDateString()
    ) {
      continued.add(entry.message.id);
    }
    previousKey = key;
    previousAt = createdAt;
  }
  return continued;
}
