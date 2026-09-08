import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { members } from "../../db/schema/members";

export function membersInsertRegister(
  storage: DurableObjectStorage,
  principalId: string,
  createdAt: string,
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.run(
      db.insert(members).values({
        principal_kind: "agent",
        principal_id: principalId,
        role: "member",
        created_at: createdAt,
      }),
    ),
  );
}
