import { sql } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { databases } from "../../db/schema/databases";

export function databasesUpsertDatabase(
  storage: DurableObjectStorage,
  {
    databaseId,
    conversationId,
    databaseJson,
    updatedAt,
  }: {
    databaseId: string;
    conversationId: string;
    databaseJson: string;
    updatedAt: number;
  },
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.run(
      db
        .insert(databases)
        .values({
          database_id: databaseId,
          conversation_id: conversationId,
          database_json: databaseJson,
          updated_at: updatedAt,
        })
        .onConflictDoUpdate({
          target: [databases.database_id],
          set: {
            conversation_id: sql`excluded.conversation_id`,
            database_json: sql`excluded.database_json`,
            updated_at: sql`excluded.updated_at`,
          },
        }),
    ),
  );
}
