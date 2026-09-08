import { and, eq } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { members } from "../../db/schema/members";

export function membersDeleteDisconnect(
  storage: DurableObjectStorage,
  principalId: string,
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.run(
      db
        .delete(members)
        .where(
          and(
            eq(members.principal_kind, "agent"),
            eq(members.principal_id, principalId),
          ),
        ),
    ),
  );
}
