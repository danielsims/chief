import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { workspace } from "../../db/schema/workspace";

export function workspaceInsertClaim(
  storage: DurableObjectStorage,
  {
    workspaceId,
    name,
    createdAt,
    createdByUserId,
  }: {
    workspaceId: string;
    name: string;
    createdAt: string;
    createdByUserId: string;
  },
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.run(
      db.insert(workspace).values({
        singleton: 1,
        workspace_id: workspaceId,
        name: name,
        created_at: createdAt,
        created_by_user_id: createdByUserId,
      }),
    ),
  );
}
