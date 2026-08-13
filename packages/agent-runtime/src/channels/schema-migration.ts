import type { Client } from "@libsql/client";

import * as schema from "../db/schema.js";
import { MISSION_CONTROL_CHANNEL_ID } from "./nip29.js";

const channelManagementColumns = [
  [schema.channels.userIds.name, "text DEFAULT '[]' NOT NULL"],
  [schema.channels.visibility.name, "text DEFAULT 'public' NOT NULL"],
  [schema.channels.kind.name, "text DEFAULT 'standard' NOT NULL"],
  [schema.channels.lifecycle.name, "text DEFAULT 'active' NOT NULL"],
  [schema.channels.archivedAt.name, "integer"],
  [schema.channels.createdBy.name, "text"],
  [schema.channels.agentPermissions.name, "text"],
  [schema.channels.workstream.name, "text"],
  [schema.channels.operationKey.name, "text"],
  [schema.channels.version.name, "integer DEFAULT 1 NOT NULL"],
] as const;

const scheduledWorkColumns = [
  [schema.schedules.trigger.name, "text"],
  [schema.schedules.operationKey.name, "text"],
  [schema.schedules.version.name, "integer DEFAULT 1 NOT NULL"],
  [schema.schedules.webhookSecretHash.name, "text"],
] as const;

const scheduleSessionColumns = [
  [schema.sessions.triggerContext.name, "text"],
] as const;

const auditChainColumns = [
  [schema.channelAudit.sequence.name, "integer DEFAULT 1 NOT NULL"],
  [schema.channelAudit.previousHash.name, "text"],
  [schema.channelAudit.hash.name, "text"],
] as const;

const agentPreferenceColumns = [
  [schema.agentPreferences.toolPermissions.name, "text"],
] as const;

const LEGACY_GETTING_STARTED_CHANNEL_ID =
  "04e8b4b0-3b65-4a83-a2e0-7fd5aa9f70c4";

async function addMissingColumns(
  client: Client,
  table: string,
  columns: readonly (readonly [string, string])[],
) {
  const result = await client.execute(`PRAGMA table_info(${table})`);
  const existing = new Set(
    result.rows.flatMap((row) =>
      typeof row.name === "string" ? [row.name] : [],
    ),
  );
  for (const [name, definition] of columns) {
    if (existing.has(name)) continue;
    await client.execute(`ALTER TABLE ${table} ADD ${name} ${definition}`);
  }
}

async function migrateChiefAgentIdentity(client: Client) {
  await client.execute(`
    DELETE FROM preference
    WHERE agent_id = 'cmo'
      AND EXISTS (
        SELECT 1 FROM preference AS current
        WHERE current.organization_id = preference.organization_id
          AND current.agent_id = 'chief'
      )
  `);
  for (const statement of [
    "UPDATE preference SET agent_id = 'chief' WHERE agent_id = 'cmo'",
    "UPDATE session SET agent = 'chief' WHERE agent = 'cmo'",
    "UPDATE schedule SET agent_id = 'chief' WHERE agent_id = 'cmo'",
    "UPDATE content SET agent_id = 'chief' WHERE agent_id = 'cmo'",
    "UPDATE file SET source_agent_id = 'chief' WHERE source_agent_id = 'cmo'",
    "UPDATE \"version\" SET source_agent_id = 'chief' WHERE source_agent_id = 'cmo'",
    "UPDATE action SET agent_id = 'chief' WHERE agent_id = 'cmo'",
    "UPDATE action SET source_id = 'agent-chief' WHERE source_id = 'agent-cmo'",
    `UPDATE channel
     SET agent_ids = replace(agent_ids, '"cmo"', '"chief"')
     WHERE agent_ids LIKE '%"cmo"%'`,
    "UPDATE channel SET slug = 'dm-chief' WHERE slug = 'dm-cmo'",
  ]) {
    await client.execute(statement);
  }
}

async function archiveLegacyGettingStartedChannel(client: Client) {
  const now = Date.now();
  await client.execute({
    sql: `UPDATE channel
          SET lifecycle = 'archived', archived_at = ?, updated_at = ?
          WHERE id = ? AND lifecycle = 'active'`,
    args: [now, now, LEGACY_GETTING_STARTED_CHANNEL_ID],
  });
}

async function enableDefaultMissionControlInvites(client: Client) {
  const now = Date.now();
  await client.execute({
    sql: `UPDATE channel
          SET agent_permissions = ?, updated_at = ?
          WHERE id = ?
            AND version = 1
            AND (agent_permissions IS NULL OR agent_permissions = '[]')`,
    args: [JSON.stringify(["manage_members"]), now, MISSION_CONTROL_CHANNEL_ID],
  });
}

async function migrateOwnerChannelMembership(client: Client) {
  await client.execute({
    sql: `UPDATE channel
          SET user_ids = ?
          WHERE id = ? OR slug LIKE 'dm-%'`,
    args: [JSON.stringify(["workspace-owner"]), MISSION_CONTROL_CHANNEL_ID],
  });
  await client.execute({
    sql: `UPDATE channel
          SET user_ids = ?
          WHERE EXISTS (
            SELECT 1 FROM post
            WHERE post.organization_id = channel.organization_id
              AND post.channel_id = channel.id
              AND post.tags LIKE ?
          )`,
    args: [JSON.stringify(["workspace-owner"]), '%["user","workspace-owner"]%'],
  });
}

export async function ensureChannelManagementSchema(client: Client) {
  await client.execute(`
    CREATE TABLE IF NOT EXISTS audit (
      id text PRIMARY KEY,
      organization_id text NOT NULL,
      channel_id text NOT NULL,
      action text NOT NULL,
      actor text NOT NULL,
      detail text NOT NULL,
      created_at integer NOT NULL
    )
  `);
  await addMissingColumns(client, "channel", channelManagementColumns);
  await addMissingColumns(client, "schedule", scheduledWorkColumns);
  await addMissingColumns(client, "session", scheduleSessionColumns);
  await addMissingColumns(client, "audit", auditChainColumns);
  await addMissingColumns(client, "preference", agentPreferenceColumns);
  await migrateOwnerChannelMembership(client);
  await migrateChiefAgentIdentity(client);
  await enableDefaultMissionControlInvites(client);
  await archiveLegacyGettingStartedChannel(client);
  await client.execute(`
    CREATE INDEX IF NOT EXISTS audit_channel_timeline
    ON audit (organization_id, channel_id, created_at)
  `);
  await client.execute(`
    CREATE UNIQUE INDEX IF NOT EXISTS channel_organization_operation
    ON channel (organization_id, operation_key)
  `);
  await client.execute(`
    CREATE UNIQUE INDEX IF NOT EXISTS schedule_organization_operation
    ON schedule (organization_id, operation_key)
  `);
  await client.execute(`
    CREATE UNIQUE INDEX IF NOT EXISTS session_schedule_trigger
    ON session (schedule_id, trigger_id)
    WHERE trigger_id IS NOT NULL
  `);
}
