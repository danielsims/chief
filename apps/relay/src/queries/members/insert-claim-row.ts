import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { members } from "../../db/schema/members";

export function membersInsertClaimRow(
  storage: DurableObjectStorage,
  principalId: string,
  createdAt: string,
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.run(
      db.insert(members).values({
        principal_kind: "user",
        principal_id: principalId,
        role: "owner",
        created_at: createdAt,
      }),
    ),
  );
}
