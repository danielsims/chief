import { setTimeout as delay } from "node:timers/promises";

import { isTransientRuntimeError } from "./retry-policy.js";

const RETRY_DELAYS_MS = [50, 150, 450, 1_350] as const;

/** Retries short SQLite write contention without replaying higher-level work. */
export async function retryDatabaseWrite<T>(operation: () => Promise<T>) {
  let lastError: unknown;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const wait = RETRY_DELAYS_MS[attempt];
      if (wait === undefined || !isTransientRuntimeError(error)) throw error;
      await delay(wait);
    }
  }
  throw lastError;
}
