import { sql } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { mcpCredentials } from "../../db/schema/mcp-connections";

export function mcpConnectionsUpsertCredential(
  storage: DurableObjectStorage,
  {
    connectionId,
    sealed,
    updatedAt,
  }: { connectionId: string; sealed: string; updatedAt: number },
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.run(
      db
        .insert(mcpCredentials)
        .values({ connection_id: connectionId, sealed, updated_at: updatedAt })
        .onConflictDoUpdate({
          target: [mcpCredentials.connection_id],
          set: {
            sealed: sql`excluded.sealed`,
            updated_at: sql`excluded.updated_at`,
          },
        }),
    ),
  );
}
