import type { ConversationEvent, Principal } from "@chief/relay-contracts";
import {
  conversationEventPageSchema,
  conversationEventSchema,
} from "@chief/relay-contracts";

import { initializeWorkspaceLiveTables } from "./db/migrations/initialize-workspace-live-tables";
import { workspaceLiveCountersFindCurrentSequence } from "./queries/workspace-live-counters/find-current-sequence";
import { workspaceLiveCountersUpdatePublish } from "./queries/workspace-live-counters/update-publish";
import { workspaceLiveEventsDeletePublish } from "./queries/workspace-live-events/delete-publish";
import { workspaceLiveEventsInsertPublish } from "./queries/workspace-live-events/insert-publish";
import { listConversationEvents } from "./queries/workspace-live-events/list-conversation-events";
import {
  consumeSocketTicket,
  createSocketTicket,
  initializeSocketTickets,
} from "./socket-ticket-store";

const RETAINED_EVENT_COUNT = 10_000;

interface LiveEventRow extends Record<string, SqlStorageValue> {
  sequence: number;
  event_json: string;
}

export function initializeWorkspaceLive(storage: DurableObjectStorage) {
  initializeWorkspaceLiveTables(storage);
  initializeSocketTickets(storage);
}

export class WorkspaceLiveStore {
  constructor(private readonly storage: DurableObjectStorage) {}

  createSocketTicket(principal: Principal) {
    return createSocketTicket(this.storage, principal);
  }

  consumeSocketTicket(ticket: string) {
    return consumeSocketTicket(this.storage, ticket);
  }

  currentSequence() {
    return (
      firstRow<{ value: number }>(
        workspaceLiveCountersFindCurrentSequence(this.storage),
      )?.value ?? 0
    );
  }

  publish(source: ConversationEvent): ConversationEvent {
    const conversationId = source.payload.message.conversationId;
    return this.storage.transactionSync(() => {
      const row = firstRow<{ value: number }>(
        workspaceLiveCountersUpdatePublish(this.storage),
      );
      if (!row) throw new Error("Workspace live sequence is unavailable.");
      const event = conversationEventSchema.parse({
        ...source,
        sequence: row.value,
      });
      workspaceLiveEventsInsertPublish(this.storage, {
        sequence: event.sequence,
        conversationId: conversationId,
        eventJson: JSON.stringify(event),
      });
      const pruneThrough = event.sequence - RETAINED_EVENT_COUNT;
      if (pruneThrough > 0) {
        workspaceLiveEventsDeletePublish(this.storage, pruneThrough);
      }
      return event;
    });
  }

  list(after: number, limit: number, conversationIds: readonly string[]) {
    if (conversationIds.length === 0) {
      return conversationEventPageSchema.parse({
        events: [],
        nextSequence: null,
      });
    }
    const rows = listConversationEvents<LiveEventRow>(this.storage, {
      after: after,
      conversationIds: conversationIds,
      limit: limit + 1,
    });
    const hasMore = rows.length > limit;
    const events = rows
      .slice(0, limit)
      .map((row) => conversationEventSchema.parse(JSON.parse(row.event_json)));
    return conversationEventPageSchema.parse({
      events,
      nextSequence: hasMore ? events.at(-1)?.sequence : null,
    });
  }
}

function firstRow<T>(cursor: Iterable<T>): T | undefined {
  const next = cursor[Symbol.iterator]().next();
  return next.done ? undefined : next.value;
}
