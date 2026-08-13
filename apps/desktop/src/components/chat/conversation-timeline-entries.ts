import type {
  BrowserRunRecord,
  ChiefUIMessage,
} from "@chief/agent-runtime/types";

export type TimelineEntry =
  | { type: "message"; message: ChiefUIMessage }
  | { type: "browser"; key: string; run: BrowserRunRecord };

/** Conversation surfaces contain authored messages and rich browser handoffs;
 * private specialist executions remain available through Activity only. */
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
    entries.push({ type: "message", message });
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
  return entry.type === "message"
    ? entry.message.metadata?.createdAt
    : entry.run.createdAt;
}
