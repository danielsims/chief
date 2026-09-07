import { and, eq } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { members } from "../../db/schema/members";

export function membersUpdateRefreshMemberDisplayNames(
  storage: DurableObjectStorage,
  displayName: string | null,
  principalId: string,
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.run(
      db
        .update(members)
        .set({ display_name: displayName })
        .where(
          and(
            eq(members.principal_kind, "user"),
            eq(members.principal_id, principalId),
          ),
        ),
    ),
  );
}
