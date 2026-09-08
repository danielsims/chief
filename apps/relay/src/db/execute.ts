import { HttpError } from "../http";

/** Drizzle errors include bindings, which may contain credentials or private content. */
export function executeDatabaseQuery<T>(operation: () => T): T {
  try {
    return operation();
  } catch {
    // Do not retain the original error as a cause: telemetry can serialize it.
    throw new HttpError(
      500,
      "database_operation_failed",
      "The database operation failed.",
    );
  }
}
