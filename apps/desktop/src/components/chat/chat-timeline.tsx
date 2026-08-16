import type { ReactNode } from "react";
import { Fragment } from "react";

import type { TimelineEntry } from "./conversation-timeline-entries";
import { ChatDateSeparator, chatDayKey } from "./chat-date-time";
import { timelineEntryCreatedAt } from "./conversation-timeline-entries";

function timelineEntryKey(entry: TimelineEntry) {
  if (entry.type === "browser") return entry.key;
  if (entry.type === "specialist") return `specialist:${entry.task.id}`;
  return entry.type === "action"
    ? `action:${entry.action.id}`
    : entry.message.id;
}

export function ChatTimeline({
  entries,
  initialTimestamp,
  renderEntry,
}: {
  entries: readonly TimelineEntry[];
  initialTimestamp?: number;
  renderEntry: (entry: TimelineEntry) => ReactNode;
}) {
  let previousTimestamp = initialTimestamp;
  return entries.map((entry) => {
    const content = renderEntry(entry);
    if (content === null || content === undefined || content === false) {
      return null;
    }
    const timestamp = timelineEntryCreatedAt(entry);
    const separated = chatDayKey(timestamp) !== chatDayKey(previousTimestamp);
    previousTimestamp = timestamp;
    return (
      <Fragment key={timelineEntryKey(entry)}>
        {separated ? <ChatDateSeparator timestamp={timestamp} /> : null}
        {content}
      </Fragment>
    );
  });
}
