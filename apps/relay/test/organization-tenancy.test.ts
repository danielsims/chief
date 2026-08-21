import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import {
  deleteChiefOrganization,
  ensureChiefOrganization,
  ensureChiefOrganizationMember,
  hasChiefOrganizationMembership,
  updateChiefOrganizationMemberRole,
} from "@chief/auth/d1-organizations";

describe("workspace organization tenancy", () => {
  it("uses the workspace id as the organization id and isolates memberships", async () => {
    const database = (env as unknown as Env).AUTH_DB;
    const suffix = crypto.randomUUID();
    const ownerUserId = `owner-${suffix}`;
    const memberUserId = `member-${suffix}`;
    const outsiderUserId = `outsider-${suffix}`;
    const workspaceId = `workspace-${suffix}`;
    const now = Date.now();

    await database.batch([
      userInsert(database, ownerUserId, now),
      userInsert(database, memberUserId, now),
      userInsert(database, outsiderUserId, now),
    ]);
    await ensureChiefOrganization(database, {
      name: "Tenant boundary test",
      ownerUserId,
      website: "https://example.test",
      workspaceId,
    });
    await ensureChiefOrganizationMember(database, {
      organizationId: workspaceId,
      userId: memberUserId,
    });

    expect(
      await hasChiefOrganizationMembership(database, {
        organizationId: workspaceId,
        userId: ownerUserId,
      }),
    ).toBe(true);
    expect(
      await hasChiefOrganizationMembership(database, {
        organizationId: workspaceId,
        userId: memberUserId,
      }),
    ).toBe(true);
    expect(
      await hasChiefOrganizationMembership(database, {
        organizationId: workspaceId,
        userId: outsiderUserId,
      }),
    ).toBe(false);

    await updateChiefOrganizationMemberRole(database, {
      organizationId: workspaceId,
      role: "admin",
      userId: memberUserId,
    });
    const membership = await database
      .prepare(
        "SELECT role FROM member WHERE organization_id = ? AND user_id = ?",
      )
      .bind(workspaceId, memberUserId)
      .first<{ role: string }>();
    expect(membership?.role).toBe("admin");

    const organization = await database
      .prepare("SELECT id FROM organization WHERE id = ?")
      .bind(workspaceId)
      .first<{ id: string }>();
    expect(organization?.id).toBe(workspaceId);

    await deleteChiefOrganization(database, workspaceId);
    expect(
      await hasChiefOrganizationMembership(database, {
        organizationId: workspaceId,
        userId: ownerUserId,
      }),
    ).toBe(false);
  });
});

function userInsert(database: D1Database, id: string, now: number) {
  return database
    .prepare(
      `INSERT INTO user (
        id, name, email, email_verified, created_at, updated_at
      ) VALUES (?, ?, ?, 1, ?, ?)`,
    )
    .bind(id, id, `${id}@example.test`, now, now);
}
