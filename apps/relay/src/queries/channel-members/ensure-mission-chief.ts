import { sql } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";

export function channelMembersEnsureMissionChief(
  storage: DurableObjectStorage,
  joinedAt: string,
) {
  return executeDatabaseQuery(() =>
    relayDatabase(storage).run(sql`
INSERT INTO channel_members (
          conversation_id, principal_kind, principal_id, role, joined_at
        ) SELECT 'mission-control', 'agent', 'chief', 'owner', ${joinedAt}
          WHERE EXISTS (
            SELECT 1 FROM channels WHERE conversation_id = 'mission-control'
          )
        ON CONFLICT(conversation_id, principal_kind, principal_id) DO UPDATE
          SET role = 'owner'
`),
  );
}
