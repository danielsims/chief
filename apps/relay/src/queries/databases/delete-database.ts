import { eq } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { databaseRows, databases } from "../../db/schema/databases";

/** Removes a database and every row in it. */
export function databasesDeleteDatabase(
  storage: DurableObjectStorage,
  databaseId: string,
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() => {
    db.run(
      db.delete(databaseRows).where(eq(databaseRows.database_id, databaseId)),
    );
    return db.run(
      db.delete(databases).where(eq(databases.database_id, databaseId)),
    );
  });
}
