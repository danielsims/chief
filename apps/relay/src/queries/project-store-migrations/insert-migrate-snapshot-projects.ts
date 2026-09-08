import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { projectStoreMigrations } from "../../db/schema/project-store-migrations";

export function projectStoreMigrationsInsertMigrateSnapshotProjects(
  storage: DurableObjectStorage,
  migrationId: string,
  completedAt: string,
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.run(
      db
        .insert(projectStoreMigrations)
        .values({ migration_id: migrationId, completed_at: completedAt }),
    ),
  );
}
