import type {
  ActionItem,
  BrowserRunRecord,
  ChiefUIMessage,
  SessionRecord,
} from "@chief/agent-runtime/types";

export type TimelineEntry =
  | { type: "message"; message: ChiefUIMessage }
  | { type: "browser"; key: string; run: BrowserRunRecord }
  | { type: "specialist"; task: SessionRecord }
  | { type: "action"; action: ActionItem };

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
  for (const message of messages) {
    if ((message.metadata?.threadRootId ?? null) !== threadRootId) continue;
    if (!isActivityProjection(message)) {
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
  return entry.type === "specialist"
    ? entry.task.createdAt
    : entry.action.createdAt;
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

/**
 * Places durable action UI at the point where it was raised. Keeping actions
 * outside the transcript makes a later continuation reply render above the
 * answered card, which looks like the reply disappeared.
 */
export function withActionTimelineEntries(
  entries: readonly TimelineEntry[],
  actions: readonly ActionItem[],
): TimelineEntry[] {
  const result = [...entries];
  const orderedActions = [...actions].sort(
    (left, right) =>
      left.createdAt - right.createdAt || left.id.localeCompare(right.id),
  );
  for (const action of orderedActions) {
    const insertionIndex = result.findIndex((entry) => {
      const createdAt = timelineEntryCreatedAt(entry);
      return createdAt !== undefined && createdAt > action.createdAt;
    });
    const actionEntry: TimelineEntry = { type: "action", action };
    if (insertionIndex < 0) result.push(actionEntry);
    else result.splice(insertionIndex, 0, actionEntry);
  }
  return result;
}
