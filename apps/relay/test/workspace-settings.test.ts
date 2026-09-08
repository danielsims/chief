import { describe, expect, it } from "vitest";

import {
  getOrganizationSettings,
  updateOrganizationSettings,
} from "@chief/auth/d1-organizations";

import { relayTestEnv } from "./helpers";

async function fixture() {
  const database = relayTestEnv().AUTH_DB;
  const owner = crypto.randomUUID();
  const outsider = crypto.randomUUID();
  const workspaceId = crypto.randomUUID();
  for (const id of [owner, outsider]) {
    await database
      .prepare(
        "INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)",
      )
      .bind(id, id, `${id}@test.example`, Date.now(), Date.now())
      .run();
  }
  await database
    .prepare(
      "INSERT INTO organization (id, slug, name, created_at, metadata) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(
      workspaceId,
      workspaceId,
      "Original",
      Date.now(),
      JSON.stringify({ preserved: { nested: true } }),
    )
    .run();
  await database
    .prepare(
      "INSERT INTO member (id, organization_id, user_id, role, created_at) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(crypto.randomUUID(), workspaceId, owner, "owner", Date.now())
    .run();
  return { database, workspaceId, owner, outsider };
}

describe("workspace settings", () => {
  it("binds SQL-like input as values and preserves unrelated metadata", async () => {
    const { database, workspaceId, owner } = await fixture();
    const name = "Team'); DROP TABLE user; --";
    const updated = await updateOrganizationSettings(database, {
      workspaceId,
      userId: owner,
      name,
      website: "https://example.test",
      imageURL: null,
    });
    expect(updated).toEqual({ id: workspaceId });
    const stored = await getOrganizationSettings(database, workspaceId);
    expect(stored?.name).toBe(name);
    expect(JSON.parse(stored?.metadata ?? "{}")).toMatchObject({
      preserved: { nested: true },
      websiteUrl: "https://example.test",
    });
    expect(
      await database
        .prepare("SELECT id FROM user WHERE id = ?")
        .bind(owner)
        .first(),
    ).toEqual({ id: owner });
  });
  it("rejects non-owners and cross-tenant writes at the query boundary", async () => {
    const { database, workspaceId, owner, outsider } = await fixture();
    const other = await fixture();
    for (const input of [
      { workspaceId, userId: outsider },
      { workspaceId: other.workspaceId, userId: owner },
    ]) {
      expect(
        await updateOrganizationSettings(database, {
          ...input,
          name: "Denied",
          website: "",
          imageURL: null,
        }),
      ).toBeUndefined();
      expect(
        (await getOrganizationSettings(database, input.workspaceId))?.name,
      ).toBe("Original");
    }
  });
});
