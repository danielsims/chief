import { sql } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { projectIcons } from "../../db/schema/project-icons";

export function projectIconsUpsert(
  storage: DurableObjectStorage,
  {
    projectId,
    dataUrl,
    updatedAt,
  }: { projectId: string; dataUrl: string; updatedAt: string },
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.run(
      db
        .insert(projectIcons)
        .values({
          project_id: projectId,
          data_url: dataUrl,
          updated_at: updatedAt,
        })
        .onConflictDoUpdate({
          target: [projectIcons.project_id],
          set: {
            data_url: sql`excluded.data_url`,
            updated_at: sql`excluded.updated_at`,
          },
        }),
    ),
  );
}
