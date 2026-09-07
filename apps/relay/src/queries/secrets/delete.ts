import { eq } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { secrets } from "../../db/schema/secrets";

export function secretsDelete(storage: DurableObjectStorage, key: string) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.run(db.delete(secrets).where(eq(secrets.key, key))),
  );
}
