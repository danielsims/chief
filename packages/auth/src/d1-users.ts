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
