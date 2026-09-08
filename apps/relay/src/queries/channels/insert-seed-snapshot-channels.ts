import { sql } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { channels } from "../../db/schema/channels";

export function channelsInsertSeedSnapshotChannels(
  storage: DurableObjectStorage,
  {
    conversationId,
    workspaceId,
    name,
    kind,
    isPrivate,
    archived,
    createdById,
    createdAt,
    updatedAt,
  }: {
    conversationId: string;
    workspaceId: string;
    name: string;
    kind: string;
    isPrivate: number;
    archived: number;
    createdById: string;
    createdAt: string;
    updatedAt: string;
  },
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.run(
      db
        .insert(channels)
        .values({
          conversation_id: conversationId,
          workspace_id: workspaceId,
          name: name,
          kind: kind,
          is_private: isPrivate,
          archived: archived,
          description: null,
          created_by_kind: "user",
          created_by_id: createdById,
          version: 1,
          created_at: createdAt,
          updated_at: updatedAt,
        })
        .onConflictDoUpdate({
          target: [channels.conversation_id],
          set: { kind: sql`excluded.kind` },
        }),
    ),
  );
}
