import type { ConversationEvent, Principal } from "@chief/relay-contracts";
import {
  conversationEventPageSchema,
  conversationEventSchema,
} from "@chief/relay-contracts";

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
  storage.sql.exec(`
    CREATE TABLE IF NOT EXISTS workspace_live_counters (
      name TEXT PRIMARY KEY,
      value INTEGER NOT NULL
    );
    INSERT OR IGNORE INTO workspace_live_counters (name, value)
      VALUES ('sequence', 0);
    CREATE TABLE IF NOT EXISTS workspace_live_events (
      sequence INTEGER PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      event_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS workspace_live_events_conversation_idx
      ON workspace_live_events (conversation_id, sequence);
  `);
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
        this.storage.sql.exec(
          "SELECT value FROM workspace_live_counters WHERE name = 'sequence'",
        ),
      )?.value ?? 0
    );
  }

  publish(source: ConversationEvent): ConversationEvent {
    const conversationId = source.payload.message.conversationId;
    return this.storage.transactionSync(() => {
      const row = firstRow<{ value: number }>(
        this.storage.sql.exec(
          `UPDATE workspace_live_counters SET value = value + 1
           WHERE name = 'sequence' RETURNING value`,
        ),
      );
      if (!row) throw new Error("Workspace live sequence is unavailable.");
      const event = conversationEventSchema.parse({
        ...source,
        sequence: row.value,
      });
      this.storage.sql.exec(
        `INSERT INTO workspace_live_events (
          sequence, conversation_id, event_json
        ) VALUES (?, ?, ?)`,
        event.sequence,
        conversationId,
        JSON.stringify(event),
      );
      const pruneThrough = event.sequence - RETAINED_EVENT_COUNT;
      if (pruneThrough > 0) {
        this.storage.sql.exec(
          "DELETE FROM workspace_live_events WHERE sequence <= ?",
          pruneThrough,
        );
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
    const placeholders = conversationIds.map(() => "?").join(", ");
    const rows = [
      ...this.storage.sql.exec<LiveEventRow>(
        `SELECT sequence, event_json FROM workspace_live_events
         WHERE sequence > ? AND conversation_id IN (${placeholders})
         ORDER BY sequence ASC LIMIT ?`,
        after,
        ...conversationIds,
        limit + 1,
      ),
    ];
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
