import { describe, expect, it } from "vitest";

import { updateChiefUserImage } from "@chief/auth/d1-users";

import { relayTestEnv } from "./helpers";

describe("profile image persistence", () => {
  it("updates the Better Auth user behind an authenticated relay upload", async () => {
    const database = relayTestEnv().AUTH_DB;
    const userId = crypto.randomUUID();
    const now = Date.now();
    await database
      .prepare(
        `INSERT INTO user (
          id, name, email, email_verified, image, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(userId, "Profile Test", `${userId}@example.test`, 1, null, now, now)
      .run();

    await updateChiefUserImage(database, {
      userId,
      image: "https://relay.test/v1/assets/profiles/profile-test?v=2",
    });

    const saved = await database
      .prepare("SELECT image FROM user WHERE id = ?")
      .bind(userId)
      .first<{ image: string | null }>();
    expect(saved?.image).toBe(
      "https://relay.test/v1/assets/profiles/profile-test?v=2",
    );
  });

  it("rejects a profile update when the authenticated user no longer exists", async () => {
    await expect(
      updateChiefUserImage(relayTestEnv().AUTH_DB, {
        userId: crypto.randomUUID(),
        image: null,
      }),
    ).rejects.toThrow("authenticated Chief user no longer exists");
  });
});
