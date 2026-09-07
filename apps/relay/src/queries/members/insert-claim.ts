import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { members } from "../../db/schema/members";

export function membersInsertClaim(
  storage: DurableObjectStorage,
  principalId: string,
  createdAt: string,
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.run(
      db
        .insert(members)
        .values({
          principal_kind: "user",
          principal_id: principalId,
          role: "member",
          created_at: createdAt,
        })
        .onConflictDoNothing({
          target: [members.principal_kind, members.principal_id],
        }),
    ),
  );
}
