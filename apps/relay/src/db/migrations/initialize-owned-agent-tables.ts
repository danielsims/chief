export function initializeOwnedAgentTables(storage: DurableObjectStorage) {
  storage.sql.exec(`
    CREATE TABLE IF NOT EXISTS owned_agent_connect_codes (
      code_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      request_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      invalidated_at TEXT
    );
    CREATE INDEX IF NOT EXISTS owned_agent_connect_codes_user_idx
      ON owned_agent_connect_codes (user_id, created_at);
    CREATE TABLE IF NOT EXISTS owned_agent_requests (
      request_id TEXT PRIMARY KEY,
      code_hash TEXT NOT NULL,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      provider TEXT NOT NULL,
      pubkey TEXT NOT NULL,
      device_code_hash TEXT NOT NULL UNIQUE,
      user_code TEXT NOT NULL,
      status TEXT NOT NULL,
      agent_id TEXT,
      poll_interval INTEGER NOT NULL,
      last_polled_at TEXT,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      decided_at TEXT
    );
    CREATE INDEX IF NOT EXISTS owned_agent_requests_user_idx
      ON owned_agent_requests (user_id, status);
    CREATE TABLE IF NOT EXISTS owned_agents (
      agent_id TEXT PRIMARY KEY,
      owner_user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      provider TEXT NOT NULL,
      display_name TEXT,
      avatar_json TEXT,
      pubkey TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      revoked_at TEXT,
      revoked_by TEXT,
      last_seen_at TEXT,
      post_window_started_at TEXT,
      post_window_count INTEGER NOT NULL DEFAULT 0
    );
    CREATE UNIQUE INDEX IF NOT EXISTS owned_agents_owner_name_idx
      ON owned_agents (owner_user_id, name) WHERE status = 'active';
    CREATE TABLE IF NOT EXISTS owned_agent_channels (
      agent_id TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      added_by TEXT NOT NULL,
      added_at TEXT NOT NULL,
      PRIMARY KEY (agent_id, conversation_id)
    );
    CREATE INDEX IF NOT EXISTS owned_agent_channels_conversation_idx
      ON owned_agent_channels (conversation_id);
    CREATE TABLE IF NOT EXISTS owned_agent_threads (
      agent_id TEXT NOT NULL,
      thread_root_id TEXT NOT NULL,
      PRIMARY KEY (agent_id, thread_root_id)
    );
    CREATE TABLE IF NOT EXISTS owned_agent_challenges (
      challenge_hash TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );
  `);
}
