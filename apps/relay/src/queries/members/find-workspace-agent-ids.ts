import { asc, eq } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { members } from "../../db/schema/members";

export function membersFindWorkspaceAgentIds<
  Row extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>,
>(storage: DurableObjectStorage) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.all<Row>(
      db
        .select({
          principal_kind: members.principal_kind,
          principal_id: members.principal_id,
          role: members.role,
        })
        .from(members)
        .where(eq(members.principal_kind, "agent"))
        .orderBy(asc(members.principal_id)),
    ),
  );
}
