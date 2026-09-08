import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { channelMembers } from "../../db/schema/channel-members";

export function channelMembersInsertClaim(
  storage: DurableObjectStorage,
  {
    conversationId,
    principalId,
    joinedAt,
  }: { conversationId: string; principalId: string; joinedAt: string },
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.run(
      db
        .insert(channelMembers)
        .values({
          conversation_id: conversationId,
          principal_kind: "user",
          principal_id: principalId,
          role: "member",
          joined_at: joinedAt,
        })
        .onConflictDoNothing({
          target: [
            channelMembers.conversation_id,
            channelMembers.principal_kind,
            channelMembers.principal_id,
          ],
        }),
    ),
  );
}
