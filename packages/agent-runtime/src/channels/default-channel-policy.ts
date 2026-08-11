import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { and, eq } from "drizzle-orm";

import * as schema from "../db/schema.js";
import { defaultWorkspaceChannels } from "./nip29.js";

/** Upgrades untouched legacy defaults without overriding an owner's policy. */
export async function reconcileDefaultChannelPolicies(
  database: LibSQLDatabase,
  workspaceId: string,
) {
  const existing = await database
    .select({
      id: schema.channels.id,
      agentPermissions: schema.channels.agentPermissions,
      version: schema.channels.version,
    })
    .from(schema.channels)
    .where(eq(schema.channels.organizationId, workspaceId))
    .all();
  for (const channel of defaultWorkspaceChannels()) {
    const stored = existing.find((candidate) => candidate.id === channel.id);
    if (
      stored?.version !== 1 ||
      (stored.agentPermissions?.length ?? 0) > 0 ||
      channel.agentPermissions.length === 0
    ) {
      continue;
    }
    await database
      .update(schema.channels)
      .set({ agentPermissions: channel.agentPermissions })
      .where(
        and(
          eq(schema.channels.organizationId, workspaceId),
          eq(schema.channels.id, channel.id),
          eq(schema.channels.version, 1),
        ),
      )
      .run();
  }
}
