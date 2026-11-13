import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import { user } from "../schema/sqlite";

export async function getChiefProfile(database: D1Database, userId: string) {
  const [profile] = await drizzle(database)
    .select({
      id: user.id,
      name: user.name,
      username: user.username,
      image: user.image,
    })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  return profile ?? null;
}

export async function findUsernameOwner(
  database: D1Database,
  username: string,
) {
  const [owner] = await drizzle(database)
    .select({ id: user.id })
    .from(user)
    .where(eq(user.username, username))
    .limit(1);
  return owner?.id ?? null;
}

export async function claimUsername(
  database: D1Database,
  userId: string,
  username: string,
) {
  try {
    const [updated] = await drizzle(database)
      .update(user)
      .set({ username, updatedAt: new Date() })
      .where(eq(user.id, userId))
      .returning({ id: user.id });
    return updated ? ("saved" as const) : ("missing" as const);
  } catch (error) {
    let cause: unknown = error;
    for (let depth = 0; depth < 5 && cause instanceof Error; depth++) {
      if (
        /UNIQUE constraint failed: user\.username|user_username_unique/iu.test(
          cause.message,
        )
      )
        return "taken" as const;
      cause = cause.cause;
    }
    throw error;
  }
}

export async function getUsernames(
  database: D1Database,
  userIds: readonly string[],
) {
  if (!userIds.length) return [];
  return drizzle(database)
    .select({ id: user.id, username: user.username, name: user.name })
    .from(user)
    .where(inArray(user.id, [...new Set(userIds)]));
}
