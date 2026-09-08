import { eq } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { prospects } from "../../db/schema/prospects";

export function prospectsFindSaveProspect<
  Row extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>,
>(storage: DurableObjectStorage, prospectId: string) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.all<Row>(
      db
        .select({
          prospect_json: prospects.prospect_json,
          found_at: prospects.found_at,
        })
        .from(prospects)
        .where(eq(prospects.prospect_id, prospectId)),
    ),
  );
}
