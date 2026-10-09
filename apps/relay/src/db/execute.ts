import { HttpError } from "../http";

/** Drizzle errors include bindings, which may contain credentials or private content. */
export function executeDatabaseQuery<T>(operation: () => T): T {
  try {
    return operation();
  } catch (error) {
    // Log only SQLite's own reason (e.g. a constraint name). Drizzle's wrapper
    // message carries the bound values, so it is never logged or retained.
    console.error("relay.database_operation_failed", {
      reason: error instanceof Error ? sqliteReason(error) : "unknown",
    });
    throw new HttpError(
      500,
      "database_operation_failed",
      "The database operation failed.",
    );
  }
}

function sqliteReason(error: Error): string {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current instanceof Error; depth += 1) {
    if (!current.message.startsWith("Failed query")) {
      return current.message.slice(0, 300);
    }
    current = current.cause;
  }
  return "unknown";
}
