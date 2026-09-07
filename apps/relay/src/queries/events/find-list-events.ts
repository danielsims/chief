import { asc, gt } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { events } from "../../db/schema/events";

export function eventsFindListEvents<
  Row extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>,
>(storage: DurableObjectStorage, sequence: number, limit: number) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.all<Row>(
      db
        .select({ sequence: events.sequence, event_json: events.event_json })
        .from(events)
        .where(gt(events.sequence, sequence))
        .orderBy(asc(events.sequence))
        .limit(limit),
    ),
  );
}
