export function getWorkspaceFileColumns<
  Row extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>,
>(storage: DurableObjectStorage) {
  return storage.sql.exec<Row>("PRAGMA table_info(workspace_files)");
}
