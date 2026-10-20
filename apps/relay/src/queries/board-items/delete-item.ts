import { eq } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { boardItems } from "../../db/schema/board-items";

export function boardItemsDeleteItem(
  storage: DurableObjectStorage,
  itemId: string,
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.run(db.delete(boardItems).where(eq(boardItems.item_id, itemId))),
  );
}
