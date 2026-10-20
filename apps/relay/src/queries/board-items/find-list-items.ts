import { desc } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { boardItems } from "../../db/schema/board-items";

export function boardItemsFindListItems<
  Row extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>,
>(storage: DurableObjectStorage) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.all<Row>(
      db
        .select({ item_json: boardItems.item_json })
        .from(boardItems)
        .orderBy(desc(boardItems.updated_at)),
    ),
  );
}
