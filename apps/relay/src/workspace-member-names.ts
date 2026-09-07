import { isJsonString } from "@chief/relay-contracts";

interface UserNameRow {
  id: string;
  name: string;
}

export async function refreshMemberDisplayNames(
  storage: DurableObjectStorage,
  env: Env,
) {
  const userIds = storage.sql
    .exec<{ principal_id: string }>(
      `SELECT principal_id FROM members WHERE principal_kind = 'user'`,
    )
    .toArray()
    .map((row) => row.principal_id);
  if (userIds.length === 0) return;
  const names = await lookupAuthUserNames(env, userIds);
  for (const [userId, name] of names) {
    storage.sql.exec(
      `UPDATE members SET display_name = ? WHERE principal_kind = 'user' AND principal_id = ?`,
      name,
      userId,
    );
  }
}

export function memberDisplayNames(storage: DurableObjectStorage) {
  const names = new Map<string, string>();
  for (const row of storage.sql
    .exec<{
      principal_kind: string;
      principal_id: string;
      display_name: string | null;
    }>(`SELECT principal_kind, principal_id, display_name FROM members`)
    .toArray()) {
    if (!isJsonString(row.display_name) || !row.display_name.trim()) continue;
    names.set(
      `${row.principal_kind}:${row.principal_id}`,
      row.display_name.trim(),
    );
  }
  return names;
}

export function workspacePeople(storage: DurableObjectStorage) {
  return storage.sql
    .exec<{
      principal_id: string;
      role: string;
      display_name: string | null;
    }>(
      `SELECT principal_id, role, display_name FROM members WHERE principal_kind = 'user' ORDER BY principal_id`,
    )
    .toArray()
    .map((row) => ({
      id: row.principal_id,
      name:
        isJsonString(row.display_name) && row.display_name.trim()
          ? row.display_name.trim()
          : row.principal_id,
      role: row.role,
    }));
}

async function lookupAuthUserNames(env: Env, userIds: readonly string[]) {
  const names = new Map<string, string>();
  if (userIds.length === 0) return names;
  const placeholders = userIds.map(() => "?").join(", ");
  try {
    const rows = await env.AUTH_DB.prepare(
      `SELECT id, name FROM user WHERE id IN (${placeholders})`,
    )
      .bind(...userIds)
      .all<UserNameRow>();
    for (const row of rows.results) {
      if (row.id && row.name.trim()) names.set(row.id, row.name.trim());
    }
  } catch {
    return names;
  }
  return names;
}

export function peopleContextLines(
  people: readonly { id: string; name: string; role: string }[],
) {
  if (people.length === 0) {
    return [
      "No human members are listed yet. Do not invent a @chief (user) tag.",
    ];
  }
  const roster = people
    .map((person) => `@${person.name} (${person.role}, id ${person.id})`)
    .join("; ");
  return [
    `People in this workspace: ${roster}.`,
    "Address a person with @Name and include their id in mentions. They are users, not agents. Never write @chief (user).",
  ];
}
