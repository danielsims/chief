import { initializeSocketTickets } from "../../socket-ticket-store";

export function initializeConversationStorage(storage: DurableObjectStorage) {
  storage.sql.exec(`
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
      edited INTEGER NOT NULL DEFAULT 0,
      deleted INTEGER NOT NULL DEFAULT 0,
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
  `);
  initializeSocketTickets(storage);
  const columns = new Set(
    storage.sql
      .exec<{ name: string }>("PRAGMA table_info(messages)")
      .toArray()
      .map((column) => column.name),
  );
  const additions = [
    [
      "mentions_json",
      "ALTER TABLE messages ADD COLUMN mentions_json TEXT NOT NULL DEFAULT '[]'",
    ],
    [
      "reactions_json",
      "ALTER TABLE messages ADD COLUMN reactions_json TEXT NOT NULL DEFAULT '[]'",
    ],
    [
      "edited",
      "ALTER TABLE messages ADD COLUMN edited INTEGER NOT NULL DEFAULT 0",
    ],
    [
      "deleted",
      "ALTER TABLE messages ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0",
    ],
  ] as const;
  for (const [column, statement] of additions) {
    if (!columns.has(column)) storage.sql.exec(statement);
  }
}
