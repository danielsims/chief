import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { channelMembers } from "../../db/schema/channel-members";

export function channelMembersInsertPrepareScheduleChannelRow(
  storage: DurableObjectStorage,
  {
    conversationId,
    principalKind,
    principalId,
    role,
    joinedAt,
  }: {
    conversationId: string;
    principalKind: string;
    principalId: string;
    role: string;
    joinedAt: string;
  },
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.run(
      db
        .insert(channelMembers)
        .values({
          conversation_id: conversationId,
          principal_kind: principalKind,
          principal_id: principalId,
          role: role,
          joined_at: joinedAt,
        })
        .onConflictDoNothing(),
    ),
  );
}
