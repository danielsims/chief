import { desc } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { prospects } from "../../db/schema/prospects";

export function prospectsFindListProspects<
  Row extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>,
>(storage: DurableObjectStorage) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.all<Row>(
      db
        .select({ prospect_json: prospects.prospect_json })
        .from(prospects)
        .orderBy(desc(prospects.updated_at))
        .limit(500),
    ),
  );
}
