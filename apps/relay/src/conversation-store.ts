import type {
  AppendMessageCommand,
  AppendMessageResult,
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
  messagePageSchema,
} from "@chief/relay-contracts";

interface AppendInput {
  command: AppendMessageCommand;
  workspaceId: WorkspaceId;
  author: MessageAuthor;
  actor: Principal;
}

type StoredAppend = AppendMessageResult & { event: Record<string, unknown> };

export interface ConversationStore {
  append(input: AppendInput): StoredAppend;
  list(
    after: number,
    limit: number,
  ): {
    messages: ConversationMessage[];
    nextSequence: number | null;
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
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS messages_sequence_idx ON messages (sequence);
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
    // Lightweight migration: existing cells predate the mentions column.
    try {
      this.storage.sql.exec(
        "ALTER TABLE messages ADD COLUMN mentions_json TEXT NOT NULL DEFAULT '[]'",
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
        mentions: input.command.payload.mentions ?? [],
        components: input.command.payload.components,
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
        JSON.stringify(message.mentions ?? []),
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

  list(after: number, limit: number) {
    const rows = [
      ...this.storage.sql.exec<MessageRow>(
        `SELECT * FROM messages
         WHERE sequence > ? ORDER BY sequence ASC LIMIT ?`,
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
    createdAt: row.created_at,
  };
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
