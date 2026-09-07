export function addProjectRepositoryFiles<
  Row extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>,
>(storage: DurableObjectStorage) {
  return storage.sql.exec<Row>(
    "ALTER TABLE projects ADD COLUMN repository_files_json TEXT",
  );
}
