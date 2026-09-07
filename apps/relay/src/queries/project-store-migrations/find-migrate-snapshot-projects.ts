import { eq } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { projectStoreMigrations } from "../../db/schema/project-store-migrations";

export function projectStoreMigrationsFindMigrateSnapshotProjects<
  Row extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>,
>(storage: DurableObjectStorage, migrationId: string) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.all<Row>(
      db
        .select({ migration_id: projectStoreMigrations.migration_id })
        .from(projectStoreMigrations)
        .where(eq(projectStoreMigrations.migration_id, migrationId)),
    ),
  );
}
