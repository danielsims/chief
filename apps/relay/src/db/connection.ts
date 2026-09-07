import { drizzle } from "drizzle-orm/durable-sqlite";

/** The caller supplies its authority object's storage; no shared tenant connection. */
export function relayDatabase(storage: DurableObjectStorage) {
  return drizzle(storage, { logger: false });
}
