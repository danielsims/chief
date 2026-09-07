import { inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import { user } from "../schema/sqlite";

export async function getUserNames(
  database: D1Database,
  userIds: readonly string[],
) {
  if (userIds.length === 0) return [];
  return drizzle(database)
    .select({ id: user.id, name: user.name })
    .from(user)
    .where(inArray(user.id, [...userIds]));
}
