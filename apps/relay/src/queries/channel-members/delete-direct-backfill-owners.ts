import { sql } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";

/** Removes owners the snapshot backfill wrongly added to started DMs. A started
 * DM (`dm-*`) has exactly one owner: the principal who started it. */
export function channelMembersDeleteDirectBackfillOwners(
  storage: DurableObjectStorage,
) {
  return executeDatabaseQuery(() =>
    relayDatabase(storage).run(sql`
DELETE FROM channel_members
         WHERE role = 'owner'
           AND conversation_id IN (
             SELECT conversation_id FROM channels
             WHERE kind = 'direct' AND conversation_id LIKE 'dm-%'
           )
           AND NOT EXISTS (
             SELECT 1 FROM channels c
             WHERE c.conversation_id = channel_members.conversation_id
               AND c.created_by_kind = channel_members.principal_kind
               AND c.created_by_id = channel_members.principal_id
           )
`),
  );
}
