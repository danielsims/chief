import { sql } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";

export function workspaceDirectoryV2FindActiveDirectory<
  Row extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>,
>(storage: DurableObjectStorage, devicePubkey: string) {
  return executeDatabaseQuery(() =>
    relayDatabase(storage).all<Row>(sql`
SELECT directory.* FROM workspace_directory_v2 AS directory
         INNER JOIN device_active_workspaces AS active
           ON active.workspace_id = directory.workspace_id
         WHERE active.device_pubkey = ${devicePubkey} LIMIT 1
`),
  );
}
