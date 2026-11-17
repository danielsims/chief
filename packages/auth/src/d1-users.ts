import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import { user } from "./schema/sqlite";

export async function updateChiefUserImage(
  database: D1Database,
  input: { userId: string; image: string | null },
) {
  const [updated] = await drizzle(database)
    .update(user)
    .set({ image: input.image, updatedAt: new Date() })
    .where(eq(user.id, input.userId))
    .returning({ id: user.id });
  if (!updated) {
    throw new Error("The authenticated Chief user no longer exists.");
  }
}

/** The name people see for this account; signing in again never replaces it. */
export async function updateChiefUserName(
  database: D1Database,
  input: { userId: string; name: string },
) {
  const [updated] = await drizzle(database)
    .update(user)
    .set({ name: input.name, updatedAt: new Date() })
    .where(eq(user.id, input.userId))
    .returning({ id: user.id });
  return Boolean(updated);
}

export { getUserNames } from "./queries/get-user-names";
export {
  getChiefProfile,
  findUsernameOwner,
  claimUsername,
} from "./queries/usernames";

export { getUsernames } from "./queries/usernames";
