import { AsyncLocalStorage } from "node:async_hooks";

/** Rows an entry point may read before its cost is logged. */
const LOGGED_ROWS_READ = 20;

interface SqlMeter {
  readonly cursors: SqlStorageCursor<Record<string, SqlStorageValue>>[];
}

const meters = new AsyncLocalStorage<SqlMeter>();

/**
 * Durable Object SQLite bills every row a query visits. Recording each cursor
 * lets an entry point report what it actually cost, so a scan shows up in the
 * logs by operation instead of only in the daily account total.
 */
export function meterSql(storage: DurableObjectStorage) {
  const sql = storage.sql;
  const exec = sql.exec.bind(sql);
  sql.exec = <Row extends Record<string, SqlStorageValue>>(
    query: string,
    ...bindings: SqlStorageValue[]
  ) => {
    const cursor = exec<Row>(query, ...bindings);
    meters.getStore()?.cursors.push(cursor);
    return cursor;
  };
}

/** A low-cardinality name for a request: its internal operation, else its route. */
export function requestOperation(request: Request) {
  const operation = request.headers.get("x-chief-internal-operation");
  if (operation) return operation;
  if (request.headers.get("upgrade") === "websocket")
    return "websocket.connect";
  const path = new URL(request.url).pathname
    .split("/")
    .map((segment) =>
      segment.length >= 20 || /\d/u.test(segment) ? ":id" : segment,
    )
    .join("/");
  return `${request.method} ${path}`;
}

export async function metered<T>(
  object: string,
  operation: string,
  run: () => T | Promise<T>,
): Promise<T> {
  const meter: SqlMeter = { cursors: [] };
  try {
    return await meters.run(meter, run);
  } finally {
    let rowsRead = 0;
    let rowsWritten = 0;
    for (const cursor of meter.cursors) {
      rowsRead += cursor.rowsRead;
      rowsWritten += cursor.rowsWritten;
    }
    if (rowsRead >= LOGGED_ROWS_READ) {
      console.log(
        JSON.stringify({
          event: "relay.sql_rows",
          object,
          operation,
          rowsRead,
          rowsWritten,
          queries: meter.cursors.length,
        }),
      );
    }
  }
}
