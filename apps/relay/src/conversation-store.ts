import type { z } from "zod";

import type {
  AppendMessageCommand,
  AppendMessageResult,
  ConversationEvent,
  ConversationMessage,
  MessageAuthor,
  MessageReaction,
  Principal,
  WorkspaceId,
} from "@chief/relay-contracts";
import {
  appendMessageResultSchema,
  conversationEventPageSchema,
  conversationEventSchema,
  messagePageSchema,
  reactToMessageResultSchema,
} from "@chief/relay-contracts";

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

type StoredAppend = AppendMessageResult & { event: Record<string, unknown> };

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
    event: Record<string, unknown> | null;
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
    this.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS counters (
        name TEXT PRIMARY KEY,
        value INTEGER NOT NULL
      );
      INSERT OR IGNORE INTO counters (name, value) VALUES ('sequence', 0);
      CREATE TABLE IF NOT EXISTS messages (
        message_id TEXT PRIMARY KEY,
        command_id TEXT NOT NULL UNIQUE,
        sequence INTEGER NOT NULL UNIQUE,
        workspace_id TEXT NOT NULL,
        conversation_id TEXT NOT NULL,
        thread_root_id TEXT,
        author_kind TEXT NOT NULL,
        author_id TEXT NOT NULL,
        body TEXT NOT NULL,
        mentions_json TEXT NOT NULL DEFAULT '[]',
        components_json TEXT NOT NULL,
        reactions_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS messages_sequence_idx ON messages (sequence);
      CREATE INDEX IF NOT EXISTS messages_thread_idx ON messages (thread_root_id);
      CREATE TABLE IF NOT EXISTS events (
        sequence INTEGER PRIMARY KEY,
        event_id TEXT NOT NULL UNIQUE,
        event_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS receipts (
        command_id TEXT PRIMARY KEY,
        result_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS socket_tickets (
        ticket_hash TEXT PRIMARY KEY,
        principal_json TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS socket_tickets_expiry_idx
        ON socket_tickets (expires_at);
    `);
    // Lightweight migrations: existing cells predate the mentions/reactions
    // columns.
    try {
      this.storage.sql.exec(
        "ALTER TABLE messages ADD COLUMN mentions_json TEXT NOT NULL DEFAULT '[]'",
      );
    } catch {
      // Column already exists — nothing to migrate.
    }
    try {
      this.storage.sql.exec(
        "ALTER TABLE messages ADD COLUMN reactions_json TEXT NOT NULL DEFAULT '[]'",
      );
    } catch {
      // Column already exists — nothing to migrate.
    }
  }

  async createSocketTicket(principal: Principal) {
    const ticket = randomTicket();
    const expiresAt = new Date(Date.now() + 30_000).toISOString();
    this.storage.sql.exec(
      `INSERT INTO socket_tickets (ticket_hash, principal_json, expires_at)
       VALUES (?, ?, ?)`,
      await hashTicket(ticket),
      JSON.stringify(principal),
      expiresAt,
    );
    this.storage.sql.exec(
      "DELETE FROM socket_tickets WHERE expires_at < ?",
      new Date().toISOString(),
    );
    return { ticket, expiresAt };
  }

  async consumeSocketTicket(ticket: string) {
    const ticketHash = await hashTicket(ticket);
    return this.storage.transactionSync(() => {
      const row = firstRow<SocketTicketRow>(
        this.storage.sql.exec(
          `DELETE FROM socket_tickets WHERE ticket_hash = ?
           RETURNING principal_json, expires_at`,
          ticketHash,
        ),
      );
      if (!row || row.expires_at < new Date().toISOString()) return null;
      return row.principal_json;
    });
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
        const stored = JSON.parse(prior.result_json) as StoredAppend;
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
        createdAt,
        sequence: counter.value,
      } satisfies ConversationMessage;
      const event = {
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
      };
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
    return row ? (toMessage(row) as unknown as ConversationMessage) : null;
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
        message: updated as unknown as ConversationMessage,
      });
      let event: Record<string, unknown> | null = null;
      if (changed) {
        event = {
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
        };
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

interface MessageRow extends Record<string, SqlStorageValue> {
  message_id: string;
  sequence: number;
  workspace_id: string;
  conversation_id: string;
  thread_root_id: string | null;
  author_kind: "user" | "agent" | "system";
  author_id: string;
  body: string;
  mentions_json: string;
  components_json: string;
  reactions_json: string;
  created_at: string;
}

interface EventRow extends Record<string, SqlStorageValue> {
  sequence: number;
  event_json: string;
}

interface SocketTicketRow extends Record<string, SqlStorageValue> {
  principal_json: string;
  expires_at: string;
}

function toMessage(row: MessageRow) {
  return {
    id: row.message_id,
    sequence: row.sequence,
    workspaceId: row.workspace_id,
    conversationId: row.conversation_id,
    threadRootId: row.thread_root_id ?? undefined,
    author: { kind: row.author_kind, id: row.author_id },
    body: row.body,
    mentions: JSON.parse(row.mentions_json) as unknown,
    components: JSON.parse(row.components_json) as unknown,
    reactions: parseReactions(row.reactions_json),
    createdAt: row.created_at,
  };
}

function parseReactions(json: string): MessageReaction[] {
  const parsed: unknown = JSON.parse(json);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(
    (entry): entry is MessageReaction =>
      entry !== null &&
      typeof entry === "object" &&
      typeof (entry as MessageReaction).emoji === "string" &&
      Array.isArray((entry as MessageReaction).pubkeys),
  );
}

function escapeLike(value: string) {
  return value
    .replace(/\\/gu, "\\\\")
    .replace(/%/gu, "\\%")
    .replace(/_/gu, "\\_");
}

function firstRow<T>(cursor: Iterable<T>): T | undefined {
  return cursor[Symbol.iterator]().next().value as T | undefined;
}

function randomTicket() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/gu, "-")
    .replace(/\//gu, "_")
    .replace(/=+$/gu, "");
}

async function hashTicket(ticket: string) {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ticket)),
  );
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
