export function migrateAccountDirectory<
  Row extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>,
>(storage: DurableObjectStorage) {
  return storage.sql.exec<Row>(`
    INSERT INTO workspace_directory_v2 (
      workspace_id, operation_id, name, website, create_command_json,
      created_at, active
    )
    SELECT workspace_id, command_id,
      COALESCE(json_extract(draft_json, '$.name'), 'Workspace'),
      COALESCE(json_extract(draft_json, '$.website'), ''),
      draft_json, created_at, active
    FROM workspace_directory
    WHERE true
    ON CONFLICT(workspace_id) DO NOTHING
  `);
}
