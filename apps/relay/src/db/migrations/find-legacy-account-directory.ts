export function findLegacyAccountDirectory<
  Row extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>,
>(storage: DurableObjectStorage) {
  return storage.sql.exec<Row>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'workspace_directory'",
  );
}
