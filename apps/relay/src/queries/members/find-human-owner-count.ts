import { and, count, eq } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { members } from "../../db/schema/members";

export function membersFindHumanOwnerCount<
  Row extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>,
>(storage: DurableObjectStorage) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.all<Row>(
      db
        .select({ count: count().as("count") })
        .from(members)
        .where(
          and(eq(members.principal_kind, "user"), eq(members.role, "owner")),
        ),
    ),
  );
}
