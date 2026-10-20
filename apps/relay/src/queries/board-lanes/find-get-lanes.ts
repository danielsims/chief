import { eq } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { boardLanes } from "../../db/schema/board-lanes";

export function boardLanesFindGetLanes<
  Row extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>,
>(storage: DurableObjectStorage, boardId: string) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.all<Row>(
      db
        .select({ lanes_json: boardLanes.lanes_json })
        .from(boardLanes)
        .where(eq(boardLanes.board_id, boardId)),
    ),
  );
}
