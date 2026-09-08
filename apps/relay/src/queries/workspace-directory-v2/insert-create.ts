import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { workspaceDirectoryV2 } from "../../db/schema/workspace-directory-v2";

export function workspaceDirectoryV2InsertCreate(
  storage: DurableObjectStorage,
  {
    workspaceId,
    operationId,
    name,
    website,
    createCommandJson,
    createdAt,
  }: {
    workspaceId: string;
    operationId: string;
    name: string;
    website: string;
    createCommandJson: string | null;
    createdAt: string;
  },
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.run(
      db.insert(workspaceDirectoryV2).values({
        workspace_id: workspaceId,
        operation_id: operationId,
        name: name,
        website: website,
        create_command_json: createCommandJson,
        created_at: createdAt,
        active: 0,
      }),
    ),
  );
}
