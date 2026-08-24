import { isJsonString } from "@chief/relay-contracts";

import { WorkspaceChannelStore } from "./workspace-channel-store";
import { initializeWorkspaceData } from "./workspace-data-store";
import { initializeWorkspaceLive } from "./workspace-live-store";
import { initializeWorkspaceLog } from "./workspace-log-store";

export function initializeWorkspaceSchema(
  storage: DurableObjectStorage,
  env: Env,
) {
  storage.sql.exec(`
    CREATE TABLE IF NOT EXISTS workspace (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      workspace_id TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      created_by_user_id TEXT NOT NULL,
      snapshot_json TEXT
    );
    CREATE TABLE IF NOT EXISTS members (
      principal_kind TEXT NOT NULL,
      principal_id TEXT NOT NULL,
      role TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (principal_kind, principal_id)
    );
    CREATE TABLE IF NOT EXISTS agent_keys (
      agent_id TEXT PRIMARY KEY,
      pubkey TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS channels (
      conversation_id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      name TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'channel',
      is_private INTEGER NOT NULL DEFAULT 0,
      archived INTEGER NOT NULL DEFAULT 0,
      description TEXT,
      created_by_kind TEXT NOT NULL,
      created_by_id TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS channel_members (
      conversation_id TEXT NOT NULL,
      principal_kind TEXT NOT NULL,
      principal_id TEXT NOT NULL,
      role TEXT NOT NULL,
      joined_at TEXT NOT NULL,
      PRIMARY KEY (conversation_id, principal_kind, principal_id)
    );
    CREATE TABLE IF NOT EXISTS channel_membership_events (
      conversation_id TEXT NOT NULL,
      principal_kind TEXT NOT NULL,
      principal_id TEXT NOT NULL,
      event_json TEXT NOT NULL,
      published INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (conversation_id, principal_kind, principal_id)
    );
    CREATE TABLE IF NOT EXISTS channel_membership_batches (
      command_id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      event_json TEXT NOT NULL,
      published INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS agent_configs (
      agent_id TEXT PRIMARY KEY,
      config_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS policy (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS workspace_invites (
      invite_id TEXT PRIMARY KEY,
      secret_hash TEXT NOT NULL UNIQUE,
      conversation_id TEXT,
      created_by_user_id TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      use_count INTEGER NOT NULL DEFAULT 0,
      revoked_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS workspace_invite_claims (
      invite_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      claimed_at TEXT NOT NULL,
      PRIMARY KEY (invite_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS workspace_invites_secret_idx
      ON workspace_invites (secret_hash);
  `);
  migrateLegacyChannelSchema(storage);
  storage.sql.exec(`
    CREATE INDEX IF NOT EXISTS channels_workspace_idx
      ON channels (workspace_id);
    CREATE INDEX IF NOT EXISTS channel_members_ctable_idx
      ON channel_members (conversation_id);
  `);
  const channelStore = new WorkspaceChannelStore(storage, env);
  channelStore.ensureSnapshotChannels();
  storage.sql.exec(
    "UPDATE channels SET is_private = 0 WHERE conversation_id = 'mission-control'",
  );
  initializeWorkspaceLog(storage);
  initializeWorkspaceData(storage);
  initializeWorkspaceLive(storage);
}

function migrateLegacyChannelSchema(storage: DurableObjectStorage) {
  const existing = new Set(
    storage.sql
      .exec<Record<string, SqlStorageValue>>("PRAGMA table_info(channels)")
      .toArray()
      .map((column) => (isJsonString(column.name) ? column.name : "")),
  );
  const add = (name: string, definition: string) => {
    if (existing.has(name)) return;
    storage.sql.exec(`ALTER TABLE channels ADD COLUMN ${name} ${definition}`);
    existing.add(name);
  };

  // Early relay builds persisted a smaller channel projection. Add every
  // current field before creating indexes or reading the rows so a Durable
  // Object can upgrade in place without discarding workspace data.
  add("workspace_id", "TEXT NOT NULL DEFAULT ''");
  add("name", "TEXT NOT NULL DEFAULT ''");
  add("kind", "TEXT NOT NULL DEFAULT 'channel'");
  add("is_private", "INTEGER NOT NULL DEFAULT 0");
  add("archived", "INTEGER NOT NULL DEFAULT 0");
  add("description", "TEXT");
  add("created_by_kind", "TEXT NOT NULL DEFAULT 'user'");
  add("created_by_id", "TEXT NOT NULL DEFAULT ''");
  add("version", "INTEGER NOT NULL DEFAULT 1");
  add("created_at", "TEXT NOT NULL DEFAULT ''");
  add("updated_at", "TEXT NOT NULL DEFAULT ''");

  storage.sql.exec(`
    UPDATE channels
       SET workspace_id = COALESCE(
             NULLIF(workspace_id, ''),
             (SELECT workspace_id FROM workspace WHERE singleton = 1),
             ''
           ),
           created_by_id = COALESCE(
             NULLIF(created_by_id, ''),
             (SELECT created_by_user_id FROM workspace WHERE singleton = 1),
             ''
           ),
           created_at = COALESCE(
             NULLIF(created_at, ''),
             (SELECT created_at FROM workspace WHERE singleton = 1),
             ''
           ),
           updated_at = COALESCE(
             NULLIF(updated_at, ''),
             (SELECT created_at FROM workspace WHERE singleton = 1),
             ''
           )
  `);
}
