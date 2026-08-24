import type {
  Client,
  InArgs,
  InStatement,
  ResultSet,
  Transaction,
  TransactionMode,
} from "@libsql/client";

import { isJsonString } from "@chief/relay-contracts";

/**
 * libSQL can overlap an interactive transaction with another operation even
 * when its connection concurrency is one. Hold a process-local queue for the
 * complete lifetime of each transaction so every LocalStore and ChannelStore
 * operation observes one ordered database boundary.
 */
export function serializeLocalClient(client: Client): Client {
  let tail: Promise<unknown> = Promise.resolve();
  const enqueue = <T>(operation: () => Promise<T>) => {
    const result = tail.then(operation, operation);
    tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
  function execute(statement: InStatement): Promise<ResultSet>;
  function execute(sql: string, args?: InArgs): Promise<ResultSet>;
  function execute(statement: InStatement | string, args?: InArgs) {
    return enqueue(() =>
      isJsonString(statement)
        ? client.execute(statement, args)
        : client.execute(statement),
    );
  }
  const transaction = (mode?: TransactionMode) => {
    let release: (() => void) | undefined;
    const occupied = new Promise<void>((resolve) => {
      release = resolve;
    });
    const previous = tail;
    tail = previous.then(
      () => occupied,
      () => occupied,
    );
    return previous.then(async () => {
      try {
        const started = await client.transaction(mode);
        let released = false;
        const finish = () => {
          if (released) return;
          released = true;
          release?.();
        };
        const wrapped: Transaction = {
          execute: started.execute.bind(started),
          batch: started.batch.bind(started),
          executeMultiple: started.executeMultiple.bind(started),
          async rollback() {
            try {
              await started.rollback();
            } finally {
              finish();
            }
          },
          async commit() {
            try {
              await started.commit();
            } finally {
              finish();
            }
          },
          close() {
            try {
              started.close();
            } finally {
              finish();
            }
          },
          get closed() {
            return started.closed;
          },
        };
        return wrapped;
      } catch (error) {
        release?.();
        throw error;
      }
    });
  };
  return {
    execute,
    batch: (statements, mode) => enqueue(() => client.batch(statements, mode)),
    migrate: (statements) => enqueue(() => client.migrate(statements)),
    transaction,
    executeMultiple: (sql) => enqueue(() => client.executeMultiple(sql)),
    sync: () => enqueue(() => client.sync()),
    close: () => client.close(),
    reconnect: () => client.reconnect(),
    get closed() {
      return client.closed;
    },
    get protocol() {
      return client.protocol;
    },
  };
}
