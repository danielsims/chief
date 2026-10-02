export function initializeChannelGuestTables(storage: DurableObjectStorage) {
  dropPreReleaseGuestTables(storage);
  storage.sql.exec(`
    CREATE TABLE IF NOT EXISTS channel_guests (
      guest_id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      name TEXT NOT NULL,
      about TEXT,
      avatar_url TEXT,
      token_hash TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL,
      wake TEXT NOT NULL,
      webhook_url TEXT,
      webhook_authorization TEXT,
      webhook_secret TEXT,
      created_at TEXT NOT NULL,
      removed_at TEXT,
      last_seen_at TEXT,
      post_window_started_at TEXT,
      post_window_count INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS channel_guests_conversation_idx
      ON channel_guests (conversation_id, status);
    CREATE TABLE IF NOT EXISTS channel_guest_threads (
      guest_id TEXT NOT NULL,
      thread_root_id TEXT NOT NULL,
      PRIMARY KEY (guest_id, thread_root_id)
    );
    CREATE TABLE IF NOT EXISTS channel_guest_subscriptions (
      subscription_id TEXT PRIMARY KEY,
      guest_id TEXT NOT NULL,
      wake TEXT NOT NULL,
      url TEXT NOT NULL,
      secret TEXT NOT NULL,
      refresh_before TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS channel_guest_subscriptions_guest_idx
      ON channel_guest_subscriptions (guest_id);
    CREATE TABLE IF NOT EXISTS channel_guest_outbox (
      delivery_id TEXT PRIMARY KEY,
      guest_id TEXT NOT NULL,
      subscription_id TEXT,
      payload_json TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS channel_guest_outbox_due_idx
      ON channel_guest_outbox (next_attempt_at);
  `);
}

/**
 * Pre-release builds let any non-private channel be joined by link. Every
 * guest and link they created is discarded once so nothing admitted under
 * that model survives; `channel_links` only exists in those builds.
 */
function dropPreReleaseGuestTables(storage: DurableObjectStorage) {
  const legacy = storage.sql
    .exec<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'channel_links'",
    )
    .toArray();
  if (legacy.length === 0) return;
  storage.sql.exec(`
    DROP TABLE IF EXISTS channel_links;
    DROP TABLE IF EXISTS channel_guests;
    DROP TABLE IF EXISTS channel_guest_threads;
    DROP TABLE IF EXISTS channel_guest_subscriptions;
    DROP TABLE IF EXISTS channel_guest_outbox;
  `);
}
