import { sql } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { deviceActiveWorkspaces } from "../../db/schema/device-active-workspaces";

export function deviceActiveWorkspacesInsertSetActiveWorkspace(
  storage: DurableObjectStorage,
  {
    devicePubkey,
    workspaceId,
    updatedAt,
  }: { devicePubkey: string; workspaceId: string; updatedAt: string },
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.run(
      db
        .insert(deviceActiveWorkspaces)
        .values({
          device_pubkey: devicePubkey,
          workspace_id: workspaceId,
          updated_at: updatedAt,
        })
        .onConflictDoUpdate({
          target: [deviceActiveWorkspaces.device_pubkey],
          set: {
            workspace_id: sql`excluded.workspace_id`,
            updated_at: sql`excluded.updated_at`,
          },
        }),
    ),
  );
}
