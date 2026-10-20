import { sql } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { boardLanes } from "../../db/schema/board-lanes";

export function boardLanesUpsertLanes(
  storage: DurableObjectStorage,
  {
    boardId,
    lanesJson,
    updatedAt,
  }: { boardId: string; lanesJson: string; updatedAt: number },
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.run(
      db
        .insert(boardLanes)
        .values({
          board_id: boardId,
          lanes_json: lanesJson,
          updated_at: updatedAt,
        })
        .onConflictDoUpdate({
          target: [boardLanes.board_id],
          set: {
            lanes_json: sql`excluded.lanes_json`,
            updated_at: sql`excluded.updated_at`,
          },
        }),
    ),
  );
}
