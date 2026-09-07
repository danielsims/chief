import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { workspace } from "../../db/schema/workspace";

export function workspaceInsertCreateManaged(
  storage: DurableObjectStorage,
  {
    workspaceId,
    name,
    createdAt,
    createdByUserId,
    snapshotJson,
  }: {
    workspaceId: string;
    name: string;
    createdAt: string;
    createdByUserId: string;
    snapshotJson: string | null;
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
        snapshot_json: snapshotJson,
      }),
    ),
  );
}
