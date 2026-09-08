import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import { member, organization } from "./schema/sqlite";

export interface ChiefOrganizationInput {
  name: string;
  ownerUserId: string;
  website: string;
  workspaceId: string;
}

export async function ensureChiefOrganization(
  database: D1Database,
  input: ChiefOrganizationInput,
) {
  const db = drizzle(database);
  const createdAt = new Date();
  await db.batch([
    db
      .insert(organization)
      .values({
        id: input.workspaceId,
        name: input.name,
        slug: input.workspaceId,
        metadata: JSON.stringify({ website: input.website }),
        createdAt,
      })
      .onConflictDoUpdate({
        target: organization.id,
        set: {
          name: input.name,
          metadata: JSON.stringify({ website: input.website }),
        },
      }),
    db
      .insert(member)
      .values({
        id: crypto.randomUUID(),
        organizationId: input.workspaceId,
        userId: input.ownerUserId,
        role: "owner",
        createdAt,
      })
      .onConflictDoUpdate({
        target: [member.organizationId, member.userId],
        set: { role: "owner" },
      }),
  ]);
}

export async function ensureChiefOrganizationMember(
  database: D1Database,
  input: { organizationId: string; userId: string; role?: string },
) {
  const db = drizzle(database);
  await db
    .insert(member)
    .values({
      id: crypto.randomUUID(),
      organizationId: input.organizationId,
      userId: input.userId,
      role: input.role ?? "member",
      createdAt: new Date(),
    })
    .onConflictDoNothing({
      target: [member.organizationId, member.userId],
    });
}

export async function hasChiefOrganizationMembership(
  database: D1Database,
  input: { organizationId: string; userId: string },
) {
  const db = drizzle(database);
  const rows = await db
    .select({ id: member.id })
    .from(member)
    .where(
      and(
        eq(member.organizationId, input.organizationId),
        eq(member.userId, input.userId),
      ),
    )
    .limit(1);
  return rows.length === 1;
}

export async function updateChiefOrganizationMemberRole(
  database: D1Database,
  input: {
    organizationId: string;
    role: "owner" | "admin" | "member";
    userId: string;
  },
) {
  const db = drizzle(database);
  const existing = await db
    .select({ id: member.id })
    .from(member)
    .where(
      and(
        eq(member.organizationId, input.organizationId),
        eq(member.userId, input.userId),
      ),
    )
    .limit(1);
  if (existing.length !== 1) {
    throw new Error("The Better Auth organization member does not exist.");
  }
  await db
    .update(member)
    .set({ role: input.role })
    .where(
      and(
        eq(member.organizationId, input.organizationId),
        eq(member.userId, input.userId),
      ),
    );
}

export async function deleteChiefOrganization(
  database: D1Database,
  organizationId: string,
) {
  const db = drizzle(database);
  await db.delete(organization).where(eq(organization.id, organizationId));
}

export { getOrganizationSettings } from "./queries/get-organization-settings";
export { updateOrganizationSettings } from "./queries/update-organization-settings";
