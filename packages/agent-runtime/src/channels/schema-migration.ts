import type { Client } from "@libsql/client";

import * as schema from "../db/schema.js";

const channelManagementColumns = [
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
