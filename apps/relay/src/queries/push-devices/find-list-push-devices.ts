import { desc } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { pushDevices } from "../../db/schema/push-devices";

export function pushDevicesFindListPushDevices<
  Row extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>,
>(storage: DurableObjectStorage) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.all<Row>(
      db
        .select({
          token: pushDevices.token,
          environment: pushDevices.environment,
        })
        .from(pushDevices)
        .orderBy(desc(pushDevices.updated_at)),
    ),
  );
}
