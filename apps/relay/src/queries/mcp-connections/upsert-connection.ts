import { sql } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { mcpConnections } from "../../db/schema/mcp-connections";

export function mcpConnectionsUpsertConnection(
  storage: DurableObjectStorage,
  {
    id,
    documentJson,
    updatedAt,
  }: { id: string; documentJson: string; updatedAt: number },
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.run(
      db
        .insert(mcpConnections)
        .values({ id, document_json: documentJson, updated_at: updatedAt })
        .onConflictDoUpdate({
          target: [mcpConnections.id],
          set: {
            document_json: sql`excluded.document_json`,
            updated_at: sql`excluded.updated_at`,
          },
        }),
    ),
  );
}
