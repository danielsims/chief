import { sql } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { databases } from "../../db/schema/databases";

export function databasesUpsertDatabase(
  storage: DurableObjectStorage,
  {
    databaseId,
    databaseJson,
    updatedAt,
  }: {
    databaseId: string;
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
          conversation_id: "",
          database_json: databaseJson,
          updated_at: updatedAt,
        })
        .onConflictDoUpdate({
          target: [databases.database_id],
          set: {
            database_json: sql`excluded.database_json`,
            updated_at: sql`excluded.updated_at`,
          },
        }),
    ),
  );
}
