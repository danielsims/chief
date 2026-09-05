import { isJsonString } from "@chief/relay-contracts";

import { WorkspaceChannelStore } from "./workspace-channel-store";
import { initializeWorkspaceData } from "./workspace-data-store";
import { initializeWorkspaceLive } from "./workspace-live-store";
import { initializeWorkspaceLog } from "./workspace-log-store";
import { initializeWorkspaceSchedules } from "./workspace-schedule-store";

export function initializeWorkspaceSchema(
  storage: DurableObjectStorage,
  env: Env,
) {
  initializeWorkspaceSchedules(storage);
  storage.sql.exec(`
    CREATE TABLE IF NOT EXISTS missions (mission_id TEXT PRIMARY KEY, document_json TEXT NOT NULL);
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
    CREATE TABLE IF NOT EXISTS secrets (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
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
    CREATE TABLE IF NOT EXISTS external_agent_runtimes (
      agent_id TEXT PRIMARY KEY,
      endpoint_url TEXT NOT NULL,
      connection_status TEXT NOT NULL DEFAULT 'pending_setup',
      token_hash TEXT NOT NULL,
      token_secret_ref TEXT NOT NULL,
      delivery_signing_key_id TEXT NOT NULL DEFAULT '',
      delivery_signing_secret_ref TEXT NOT NULL DEFAULT '',
      registration_command_id TEXT NOT NULL UNIQUE,
      registration_payload_hash TEXT NOT NULL,
      registration_result_json TEXT,
      replaces_native INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS external_agent_definitions (
      agent_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      repository_id TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      repository_identity TEXT NOT NULL,
      path TEXT NOT NULL,
      requested_ref TEXT NOT NULL,
      verification_status TEXT NOT NULL DEFAULT 'unresolved',
      resolved_commit_sha TEXT,
      content_digest TEXT,
      FOREIGN KEY (agent_id) REFERENCES external_agent_runtimes(agent_id) ON DELETE CASCADE,
      FOREIGN KEY (repository_id) REFERENCES project_repositories(repository_id) ON DELETE RESTRICT,
      FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE RESTRICT
    );
    CREATE TABLE IF NOT EXISTS external_agent_deployments (
      agent_id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      resolved_commit_sha TEXT,
      attested_at TEXT,
      FOREIGN KEY (agent_id) REFERENCES external_agent_runtimes(agent_id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS external_agent_outbox (
      agent_id TEXT NOT NULL,
      delivery_id TEXT NOT NULL,
      payload_hash TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      delivery_generation INTEGER NOT NULL DEFAULT 1,
      capability_hash TEXT NOT NULL UNIQUE,
      conversation_id TEXT NOT NULL,
      thread_root_id TEXT,
      session_address TEXT NOT NULL,
      status TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt_at TEXT NOT NULL,
      delivering_since TEXT,
      session_id TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (agent_id, delivery_id)
    );
    CREATE INDEX IF NOT EXISTS external_agent_outbox_due_idx
      ON external_agent_outbox (status, next_attempt_at);
    CREATE TABLE IF NOT EXISTS external_agent_inbound_receipts (
      agent_id TEXT NOT NULL,
      delivery_id TEXT NOT NULL,
      payload_hash TEXT NOT NULL,
      message_id TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (agent_id, delivery_id)
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
  migrateExternalAgentSchema(storage);
  addColumns(storage, "members", [["display_name", "TEXT"]]);
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

function migrateExternalAgentSchema(storage: DurableObjectStorage) {
  addColumns(storage, "external_agent_runtimes", [
    ["connection_status", "TEXT NOT NULL DEFAULT 'pending_setup'"],
    ["delivery_signing_key_id", "TEXT NOT NULL DEFAULT ''"],
    ["delivery_signing_secret_ref", "TEXT NOT NULL DEFAULT ''"],
    ["replaces_native", "INTEGER NOT NULL DEFAULT 0"],
  ]);
  addColumns(storage, "external_agent_outbox", [
    ["delivery_generation", "INTEGER NOT NULL DEFAULT 1"],
  ]);
  addColumns(storage, "external_agent_definitions", [
    ["repository_id", "TEXT NOT NULL DEFAULT ''"],
    ["provider_id", "TEXT NOT NULL DEFAULT ''"],
    ["repository_identity", "TEXT NOT NULL DEFAULT ''"],
    ["requested_ref", "TEXT NOT NULL DEFAULT ''"],
    ["content_digest", "TEXT"],
  ]);
}

function addColumns(
  storage: DurableObjectStorage,
  table: string,
  columns: readonly (readonly [string, string])[],
) {
  const existing = new Set(
    storage.sql
      .exec<Record<string, SqlStorageValue>>(`PRAGMA table_info(${table})`)
      .toArray()
      .map((column) => (isJsonString(column.name) ? column.name : "")),
  );
  for (const [name, definition] of columns) {
    if (existing.has(name)) continue;
    storage.sql.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
  }
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
