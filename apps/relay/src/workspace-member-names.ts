import { getUserNames } from "@chief/auth/d1-users";
import { isJsonString } from "@chief/relay-contracts";

import { membersFindMemberDisplayNames } from "./queries/members/find-member-display-names";
import { membersFindRefreshMemberDisplayNames } from "./queries/members/find-refresh-member-display-names";
import { membersFindWorkspacePeople } from "./queries/members/find-workspace-people";
import { membersUpdateRefreshMemberDisplayNames } from "./queries/members/update-refresh-member-display-names";

export async function refreshMemberDisplayNames(
  storage: DurableObjectStorage,
  env: Env,
) {
  const userIds = membersFindRefreshMemberDisplayNames<{
    principal_id: string;
  }>(storage).map((row) => row.principal_id);
  if (userIds.length === 0) return;
  const names = await lookupAuthUserNames(env, userIds);
  for (const [userId, name] of names) {
    membersUpdateRefreshMemberDisplayNames(storage, name, userId);
  }
}

export function memberDisplayNames(storage: DurableObjectStorage) {
  const names = new Map<string, string>();
  for (const row of membersFindMemberDisplayNames<{
    principal_kind: string;
    principal_id: string;
    display_name: string | null;
  }>(storage)) {
    if (!isJsonString(row.display_name) || !row.display_name.trim()) continue;
    names.set(
      `${row.principal_kind}:${row.principal_id}`,
      row.display_name.trim(),
    );
  }
  return names;
}

export function workspacePeople(storage: DurableObjectStorage) {
  return membersFindWorkspacePeople<{
    principal_id: string;
    role: string;
    display_name: string | null;
  }>(storage).map((row) => ({
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
  try {
    const rows = await getUserNames(env.AUTH_DB, userIds);
    for (const row of rows) {
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
