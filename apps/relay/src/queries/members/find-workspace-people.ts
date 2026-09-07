import { asc, eq } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { members } from "../../db/schema/members";

export function membersFindWorkspacePeople<
  Row extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>,
>(storage: DurableObjectStorage) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.all<Row>(
      db
        .select({
          principal_id: members.principal_id,
          role: members.role,
          display_name: members.display_name,
        })
        .from(members)
        .where(eq(members.principal_kind, "user"))
        .orderBy(asc(members.principal_id)),
    ),
  );
}
