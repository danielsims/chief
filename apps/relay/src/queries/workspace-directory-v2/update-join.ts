import { eq } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { workspaceDirectoryV2 } from "../../db/schema/workspace-directory-v2";

export function workspaceDirectoryV2UpdateJoin(
  storage: DurableObjectStorage,
  {
    name,
    website,
    workspaceId,
  }: { name: string; website: string; workspaceId: string },
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.run(
      db
        .update(workspaceDirectoryV2)
        .set({ name: name, website: website })
        .where(eq(workspaceDirectoryV2.workspace_id, workspaceId)),
    ),
  );
}
