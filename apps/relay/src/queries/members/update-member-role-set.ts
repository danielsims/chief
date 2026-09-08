import { and, eq } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { members } from "../../db/schema/members";

export function membersUpdateMemberRoleSet(
  storage: DurableObjectStorage,
  {
    role,
    principalKind,
    principalId,
  }: { role: string; principalKind: string; principalId: string },
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.run(
      db
        .update(members)
        .set({ role: role })
        .where(
          and(
            eq(members.principal_kind, principalKind),
            eq(members.principal_id, principalId),
          ),
        ),
    ),
  );
}
