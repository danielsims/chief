import type { z } from "zod";

import type {
  AppendMessageCommand,
  ConversationEvent,
  ConversationMessage,
  MessageAuthor,
  Principal,
  WorkspaceId,
} from "@chief/relay-contracts";
import {
  appendMessageResultSchema,
  conversationEventPageSchema,
  conversationEventSchema,
  conversationMessageSchema,
  messagePageSchema,
  reactToMessageResultSchema,
} from "@chief/relay-contracts";

import type { UpsertActivityInput } from "./conversation-activity-store";
import type { EventRow, MessageRow } from "./conversation-rows";
import { upsertAgentActivity } from "./conversation-activity-store";
import {
  escapeLike,
  firstConversationRow as firstRow,
  parseReactions,
  toMessage,
} from "./conversation-rows";
import { initializeConversationStorage } from "./conversation-schema";
import { HttpError } from "./http";
import { consumeSocketTicket, createSocketTicket } from "./socket-ticket-store";

interface AppendInput {
  command: AppendMessageCommand;
  workspaceId: WorkspaceId;
  author: MessageAuthor;
  actor: Principal;
}

interface ReactInput {
  messageId: string;
  emoji: string;
  pubkey: string;
  add: boolean;
  actor: Principal;
  workspaceId: WorkspaceId;
  correlationId: string;
}

interface EditInput {
  messageId: string;
  body: string;
  actor: Principal;
  workspaceId: WorkspaceId;
  correlationId: string;
}

interface DeleteInput {
  messageId: string;
  actor: Principal;
  workspaceId: WorkspaceId;
  correlationId: string;
}

const storedAppendSchema = appendMessageResultSchema.extend({
  event: conversationEventSchema,
});
type StoredAppend = z.infer<typeof storedAppendSchema>;

export interface ConversationStore {
  append(input: AppendInput): StoredAppend;
  getMessage(messageId: string): ConversationMessage | null;
  list(
    after: number,
    limit: number,
    query?: string,
  ): {
    messages: ConversationMessage[];
    nextSequence: number | null;
  };
  replies(
    rootId: string,
    after: number,
    limit: number,
  ): {
    messages: ConversationMessage[];
    nextSequence: number | null;
  };
  react(input: ReactInput): {
    changed: boolean;
    result: z.infer<typeof reactToMessageResultSchema>;
    event: ConversationEvent | null;
  };
  edit(input: EditInput): {
    message: ConversationMessage;
    event: ConversationEvent | null;
  };
  upsertActivity(input: UpsertActivityInput): {
    created: boolean;
    message: ConversationMessage;
    event: ConversationEvent;
  };
  delete(input: DeleteInput): {
    message: ConversationMessage;
    event: ConversationEvent | null;
  };
  listEvents(
    after: number,
    limit: number,
  ): {
    events: ConversationEvent[];
    nextSequence: number | null;
  };
}

export class SqlConversationStore implements ConversationStore {
  constructor(private readonly storage: DurableObjectStorage) {}

  initialize() {
    initializeConversationStorage(this.storage);
  }

  async createSocketTicket(principal: Principal) {
    return createSocketTicket(this.storage, principal);
  }

  async consumeSocketTicket(ticket: string) {
    return consumeSocketTicket(this.storage, ticket);
  }

  append(input: AppendInput): StoredAppend {
    return this.storage.transactionSync(() => {
      const prior = firstRow<{ result_json: string }>(
        this.storage.sql.exec(
          "SELECT result_json FROM receipts WHERE command_id = ?",
          input.command.commandId,
        ),
      );
      if (prior) {
        const stored = storedAppendSchema.parse(JSON.parse(prior.result_json));
        return { ...stored, duplicate: true };
      }

      const counter = firstRow<{ value: number }>(
        this.storage.sql.exec(
          "UPDATE counters SET value = value + 1 WHERE name = 'sequence' RETURNING value",
        ),
      );
      if (!counter) throw new Error("Conversation sequence is unavailable.");

      const createdAt = input.command.occurredAt;
      const message = {
        id: input.command.payload.messageId,
        workspaceId: input.workspaceId,
        conversationId: input.command.payload.conversationId,
        threadRootId: input.command.payload.threadRootId,
        author: input.author,
        body: input.command.payload.body,
        mentions: input.command.payload.mentions,
        components: input.command.payload.components,
        reactions: [],
        edited: false,
        deleted: false,
        createdAt,
        sequence: counter.value,
      } satisfies ConversationMessage;
      const event = conversationEventSchema.parse({
        eventId: crypto.randomUUID(),
        sequence: counter.value,
        protocolVersion: 1,
        workspaceId: input.workspaceId,
        streamId: `conversation:${message.conversationId}`,
        type: "conversation.message.appended",
        actor: input.actor,
        correlationId: input.command.commandId,
        causationId: input.command.commandId,
        occurredAt: createdAt,
        payload: { message },
      });
      const result = appendMessageResultSchema.parse({
        duplicate: false,
        message,
      });
      const stored = { ...result, event };

      this.storage.sql.exec(
        `INSERT INTO messages (
          message_id, command_id, sequence, workspace_id, conversation_id,
          thread_root_id, author_kind, author_id, body, mentions_json,
          components_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        message.id,
        input.command.commandId,
        message.sequence,
        message.workspaceId,
        message.conversationId,
        message.threadRootId ?? null,
        message.author.kind,
        message.author.id,
        message.body,
        JSON.stringify(message.mentions),
        JSON.stringify(message.components),
        message.createdAt,
      );
      this.storage.sql.exec(
        "INSERT INTO events (sequence, event_id, event_json) VALUES (?, ?, ?)",
        counter.value,
        event.eventId,
        JSON.stringify(event),
      );
      this.storage.sql.exec(
        "INSERT INTO receipts (command_id, result_json) VALUES (?, ?)",
        input.command.commandId,
        JSON.stringify(stored),
      );
      return stored;
    });
  }

  getMessage(messageId: string): ConversationMessage | null {
    const row = firstRow<MessageRow>(
      this.storage.sql.exec(
        "SELECT * FROM messages WHERE message_id = ?",
        messageId,
      ),
    );
    return row ? toMessage(row) : null;
  }

  list(after: number, limit: number, query?: string) {
    const normalizedQuery = query?.trim() ?? "";
    const rows = [
      ...this.storage.sql.exec<MessageRow>(
        normalizedQuery
          ? `SELECT * FROM messages
             WHERE sequence > ? AND body LIKE ? ESCAPE '\\' COLLATE NOCASE
             ORDER BY sequence ASC LIMIT ?`
          : `SELECT * FROM messages
             WHERE sequence > ? ORDER BY sequence ASC LIMIT ?`,
        ...(normalizedQuery
          ? [after, `%${escapeLike(normalizedQuery)}%`, limit + 1]
          : [after, limit + 1]),
      ),
    ];
    const hasMore = rows.length > limit;
    const messages = rows.slice(0, limit).map(toMessage);
    return messagePageSchema.parse({
      messages,
      nextSequence: hasMore ? messages.at(-1)?.sequence : null,
    });
  }

  replies(rootId: string, after: number, limit: number) {
    const rows = [
      ...this.storage.sql.exec<MessageRow>(
        `SELECT * FROM messages
         WHERE thread_root_id = ?
           AND sequence > ?
         ORDER BY sequence ASC LIMIT ?`,
        rootId,
        after,
        limit + 1,
      ),
    ];
    const hasMore = rows.length > limit;
    const messages = rows.slice(0, limit).map(toMessage);
    return messagePageSchema.parse({
      messages,
      nextSequence: hasMore ? messages.at(-1)?.sequence : null,
    });
  }

  react(input: ReactInput) {
    return this.storage.transactionSync(() => {
      const row = firstRow<MessageRow>(
        this.storage.sql.exec(
          "SELECT * FROM messages WHERE message_id = ?",
          input.messageId,
        ),
      );
      if (!row) throw new Error("Unknown message.");
      const reactions = parseReactions(row.reactions_json);
      const entry = reactions.find(
        (reaction) => reaction.emoji === input.emoji,
      );
      const present = entry ? entry.pubkeys.includes(input.pubkey) : false;
      let changed = false;

      if (input.add) {
        if (entry) {
          if (!present) {
            entry.pubkeys.push(input.pubkey);
            changed = true;
          }
        } else {
          reactions.push({ emoji: input.emoji, pubkeys: [input.pubkey] });
          changed = true;
        }
      } else if (entry && present) {
        entry.pubkeys = entry.pubkeys.filter((key) => key !== input.pubkey);
        if (entry.pubkeys.length === 0) {
          reactions.splice(reactions.indexOf(entry), 1);
        }
        changed = true;
      }

      if (changed) {
        const nextReactions = reactions
          .filter((reaction) => reaction.pubkeys.length > 0)
          .slice(0, 128);
        this.storage.sql.exec(
          "UPDATE messages SET reactions_json = ? WHERE message_id = ?",
          JSON.stringify(nextReactions),
          input.messageId,
        );
      }

      const updated = toMessage({
        ...row,
        reactions_json: JSON.stringify(reactions),
      });
      const result = reactToMessageResultSchema.parse({
        add: input.add,
        message: updated,
      });
      let event: ConversationEvent | null = null;
      if (changed) {
        event = conversationEventSchema.parse({
          eventId: crypto.randomUUID(),
          sequence: 0,
          protocolVersion: 1,
          workspaceId: input.workspaceId,
          streamId: `conversation:${updated.conversationId}`,
          type: "conversation.message.reacted",
          actor: input.actor,
          correlationId: input.correlationId,
          causationId: input.correlationId,
          occurredAt: new Date().toISOString(),
          payload: { message: updated },
        });
        this.storage.sql.exec(
          "INSERT INTO events (sequence, event_id, event_json) VALUES (?, ?, ?)",
          this.nextEventSequence(),
          event.eventId,
          JSON.stringify(event),
        );
      }
      return { changed, result, event };
    });
  }

  edit(input: EditInput) {
    return this.storage.transactionSync(() => {
      const row = firstRow<MessageRow>(
        this.storage.sql.exec(
          "SELECT * FROM messages WHERE message_id = ?",
          input.messageId,
        ),
      );
      if (!row) {
        throw new HttpError(
          404,
          "message_not_found",
          "The message was not found.",
        );
      }
      const previous = toMessage(row);
      if (previous.body === input.body && previous.edited) {
        return { message: previous, event: null };
      }
      const updated = conversationMessageSchema.parse({
        ...previous,
        body: input.body,
        edited: true,
        deleted: false,
      });
      this.storage.sql.exec(
        "UPDATE messages SET body = ?, edited = 1, deleted = 0 WHERE message_id = ?",
        updated.body,
        input.messageId,
      );
      const event = conversationEventSchema.parse({
        eventId: crypto.randomUUID(),
        sequence: this.nextEventSequence(),
        protocolVersion: 1,
        workspaceId: input.workspaceId,
        streamId: `conversation:${updated.conversationId}`,
        type: "conversation.message.edited",
        actor: input.actor,
        correlationId: input.correlationId,
        causationId: input.correlationId,
        occurredAt: new Date().toISOString(),
        payload: { message: updated },
      });
      this.storage.sql.exec(
        "INSERT INTO events (sequence, event_id, event_json) VALUES (?, ?, ?)",
        event.sequence,
        event.eventId,
        JSON.stringify(event),
      );
      return { message: updated, event };
    });
  }

  upsertActivity(input: UpsertActivityInput) {
    return upsertAgentActivity(this.storage, input, () =>
      this.nextEventSequence(),
    );
  }

  delete(input: DeleteInput) {
    return this.storage.transactionSync(() => {
      const row = firstRow<MessageRow>(
        this.storage.sql.exec(
          "SELECT * FROM messages WHERE message_id = ?",
          input.messageId,
        ),
      );
      if (!row) {
        throw new HttpError(
          404,
          "message_not_found",
          "The message was not found.",
        );
      }
      const previous = toMessage(row);
      if (previous.deleted) return { message: previous, event: null };
      const updated = conversationMessageSchema.parse({
        ...previous,
        body: "⚠️ This message was deleted.",
        edited: false,
        deleted: true,
      });
      this.storage.sql.exec(
        "UPDATE messages SET body = ?, edited = 0, deleted = 1 WHERE message_id = ?",
        updated.body,
        input.messageId,
      );
      const event = conversationEventSchema.parse({
        eventId: crypto.randomUUID(),
        sequence: this.nextEventSequence(),
        protocolVersion: 1,
        workspaceId: input.workspaceId,
        streamId: `conversation:${updated.conversationId}`,
        type: "conversation.message.deleted",
        actor: input.actor,
        correlationId: input.correlationId,
        causationId: input.correlationId,
        occurredAt: new Date().toISOString(),
        payload: { message: updated },
      });
      this.storage.sql.exec(
        "INSERT INTO events (sequence, event_id, event_json) VALUES (?, ?, ?)",
        event.sequence,
        event.eventId,
        JSON.stringify(event),
      );
      return { message: updated, event };
    });
  }

  private nextEventSequence() {
    const counter = firstRow<{ value: number }>(
      this.storage.sql.exec(
        "UPDATE counters SET value = value + 1 WHERE name = 'sequence' RETURNING value",
      ),
    );
    if (!counter) throw new Error("Conversation sequence is unavailable.");
    return counter.value;
  }

  listEvents(after: number, limit: number) {
    const rows = [
      ...this.storage.sql.exec<EventRow>(
        `SELECT sequence, event_json FROM events
         WHERE sequence > ? ORDER BY sequence ASC LIMIT ?`,
        after,
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
