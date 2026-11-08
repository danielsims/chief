import { eq } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { projectIcons } from "../../db/schema/project-icons";

export function projectIconsDelete(
  storage: DurableObjectStorage,
  projectId: string,
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.run(
      db.delete(projectIcons).where(eq(projectIcons.project_id, projectId)),
    ),
  );
}
