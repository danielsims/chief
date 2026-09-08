export function addProjectAgent<
  Row extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>,
>(storage: DurableObjectStorage) {
  return storage.sql.exec<Row>("ALTER TABLE projects ADD COLUMN agent_id TEXT");
}
