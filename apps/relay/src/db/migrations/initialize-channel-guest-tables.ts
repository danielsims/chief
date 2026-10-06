export function initializeChannelGuestTables(storage: DurableObjectStorage) {
  dropPreReleaseGuestTables(storage);
  storage.sql.exec(`
    CREATE TABLE IF NOT EXISTS channel_guests (
      guest_id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      name TEXT NOT NULL,
      about TEXT,
      avatar_url TEXT,
      handle TEXT,
      provider TEXT,
      model TEXT,
      mark_shape TEXT,
      mark_color TEXT,
      operator_user_id TEXT,
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
    CREATE TABLE IF NOT EXISTS channel_guest_invites (
      token_hash TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      operator_user_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );
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
  const columns = new Set(
    storage.sql
      .exec<{ name: string }>("PRAGMA table_info(channel_guests)")
      .toArray()
      .map((column) => column.name),
  );
  for (const name of [
    "handle",
    "provider",
    "model",
    "mark_shape",
    "mark_color",
    "operator_user_id",
  ]) {
    if (!columns.has(name)) {
      storage.sql.exec(`ALTER TABLE channel_guests ADD COLUMN ${name} TEXT`);
    }
  }
  // Every agent now works for a member. Ones admitted anonymously by
  // pre-release public links have no one vouching for them, so they go.
  storage.sql.exec(`
    DELETE FROM channel_guest_subscriptions WHERE guest_id IN (
      SELECT guest_id FROM channel_guests WHERE operator_user_id IS NULL
    );
    DELETE FROM channel_guest_outbox WHERE guest_id IN (
      SELECT guest_id FROM channel_guests WHERE operator_user_id IS NULL
    );
    UPDATE channel_guests
       SET status = 'removed',
           removed_at = COALESCE(removed_at, datetime('now')),
           webhook_url = NULL,
           webhook_authorization = NULL,
           webhook_secret = NULL
     WHERE operator_user_id IS NULL AND status = 'active';
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
