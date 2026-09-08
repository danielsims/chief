import { sql } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";

export function channelMembersAddAgentToExistingChannel(
  storage: DurableObjectStorage,
  {
    agentId,
    joinedAt,
    conversationId,
  }: { agentId: string; joinedAt: string; conversationId: string },
) {
  return executeDatabaseQuery(() =>
    relayDatabase(storage).run(sql`
INSERT INTO channel_members (
          conversation_id, principal_kind, principal_id, role, joined_at
        ) SELECT conversation_id, 'agent', ${agentId}, 'member', ${joinedAt} FROM channels
          WHERE conversation_id = ${conversationId}
        ON CONFLICT(conversation_id, principal_kind, principal_id) DO NOTHING
`),
  );
}
