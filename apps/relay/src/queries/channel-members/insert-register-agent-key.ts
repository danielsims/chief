import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { channelMembers } from "../../db/schema/channel-members";

export function channelMembersInsertRegisterAgentKey(
  storage: DurableObjectStorage,
  joinedAt: string,
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.run(
      db
        .insert(channelMembers)
        .values({
          conversation_id: "mission-control",
          principal_kind: "agent",
          principal_id: "chief",
          role: "owner",
          joined_at: joinedAt,
        })
        .onConflictDoUpdate({
          target: [
            channelMembers.conversation_id,
            channelMembers.principal_kind,
            channelMembers.principal_id,
          ],
          set: { role: "owner" },
        }),
    ),
  );
}
