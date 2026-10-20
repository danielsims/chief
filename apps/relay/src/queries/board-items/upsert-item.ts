import { sql } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { boardItems } from "../../db/schema/board-items";

export function boardItemsUpsertItem(
  storage: DurableObjectStorage,
  {
    itemId,
    itemJson,
    updatedAt,
  }: { itemId: string; itemJson: string; updatedAt: number },
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.run(
      db
        .insert(boardItems)
        .values({ item_id: itemId, item_json: itemJson, updated_at: updatedAt })
        .onConflictDoUpdate({
          target: [boardItems.item_id],
          set: {
            item_json: sql`excluded.item_json`,
            updated_at: sql`excluded.updated_at`,
          },
        }),
    ),
  );
}
