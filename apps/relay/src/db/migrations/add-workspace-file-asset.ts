export function addWorkspaceFileAsset<
  Row extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>,
>(storage: DurableObjectStorage) {
  return storage.sql.exec<Row>(
    "ALTER TABLE workspace_files ADD COLUMN asset_json TEXT",
  );
}
