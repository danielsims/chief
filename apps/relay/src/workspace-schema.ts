import { WorkspaceChannelStore } from "./workspace-channel-store";
import { initializeWorkspaceData } from "./workspace-data-store";
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
    CREATE INDEX IF NOT EXISTS channels_workspace_idx
      ON channels (workspace_id);
    CREATE INDEX IF NOT EXISTS channel_members_ctable_idx
      ON channel_members (conversation_id);
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
  `);
  const channelColumns = storage.sql
    .exec<Record<string, SqlStorageValue>>("PRAGMA table_info(channels)")
    .toArray();
  if (!channelColumns.some((column) => column.name === "kind")) {
    storage.sql.exec(
      "ALTER TABLE channels ADD COLUMN kind TEXT NOT NULL DEFAULT 'channel'",
    );
  }
  const channelStore = new WorkspaceChannelStore(storage, env);
  channelStore.ensureSnapshotChannels();
  storage.sql.exec(
    "UPDATE channels SET is_private = 0 WHERE conversation_id = 'mission-control'",
  );
  initializeWorkspaceLog(storage);
  initializeWorkspaceData(storage);
}
