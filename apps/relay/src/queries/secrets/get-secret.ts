import { eq } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { secrets } from "../../db/schema/secrets";

export function getSecretRecord<
  Row extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>,
>(storage: DurableObjectStorage, key: string) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.all<Row>(
      db
        .select({
          key: secrets.key,
          value_json: secrets.value_json,
          updated_at: secrets.updated_at,
        })
        .from(secrets)
        .where(eq(secrets.key, key)),
    ),
  );
}
