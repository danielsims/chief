import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { brandProfile } from "../../db/schema/brand-profile";

export function brandProfileFindGetBrandProfile<
  Row extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>,
>(storage: DurableObjectStorage) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.all<Row>(db.select().from(brandProfile).limit(1)),
  );
}
