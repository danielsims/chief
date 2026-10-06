import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { z } from "zod";

import { invitation, member, organization, user } from "./schema/sqlite";

const invitationExpirySeconds = 60 * 60 * 24 * 7;

const organizationMetadataSchema = z
  .object({ website: z.string().trim().max(2_048) })
  .partial();

export interface ChiefOrganizationInvitation {
  id: string;
  email: string;
  role: string;
  status: "pending" | "accepted" | "rejected" | "canceled";
  expiresAt: Date;
  createdAt: Date;
  inviterId: string;
}

export type ChiefInvitationResult =
  | { ok: true; invitation: ChiefOrganizationInvitation }
  | { ok: false; reason: "member_exists" };

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

export async function removeChiefOrganizationMember(
  database: D1Database,
  input: { organizationId: string; userId: string },
) {
  const db = drizzle(database);
  await db
    .delete(member)
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

export async function getChiefOrganizationSummary(
  database: D1Database,
  organizationId: string,
) {
  const rows = await drizzle(database)
    .select({
      id: organization.id,
      name: organization.name,
      logo: organization.logo,
      metadata: organization.metadata,
    })
    .from(organization)
    .where(eq(organization.id, organizationId))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    logo: row.logo,
    website: parseOrganizationWebsite(row.metadata) || null,
  };
}

export async function getChiefUserIdentity(
  database: D1Database,
  userId: string,
) {
  const rows = await drizzle(database)
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      image: user.image,
    })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  return rows[0] ?? null;
}

export interface ChiefOrganizationMember {
  userId: string;
  name: string;
  email: string;
  image: string | null;
  role: string;
  createdAt: Date;
}

/** Every Better Auth member of an organization, joined to their user profile. */
export async function listChiefOrganizationMembers(
  database: D1Database,
  organizationId: string,
): Promise<ChiefOrganizationMember[]> {
  const rows = await drizzle(database)
    .select({
      userId: member.userId,
      name: user.name,
      email: user.email,
      image: user.image,
      role: member.role,
      createdAt: member.createdAt,
    })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(eq(member.organizationId, organizationId));
  return rows.map((row) => ({
    userId: row.userId,
    name: row.name,
    email: row.email,
    image: row.image ?? null,
    role: row.role,
    createdAt: row.createdAt,
  }));
}

export interface ChiefUserOrganization {
  id: string;
  name: string;
  website: string;
}

/** Every organization a user belongs to, with the website stored in metadata. */
export async function listChiefUserOrganizations(
  database: D1Database,
  userId: string,
): Promise<ChiefUserOrganization[]> {
  const rows = await drizzle(database)
    .select({
      id: organization.id,
      name: organization.name,
      metadata: organization.metadata,
    })
    .from(member)
    .innerJoin(organization, eq(organization.id, member.organizationId))
    .where(eq(member.userId, userId));
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    website: parseOrganizationWebsite(row.metadata),
  }));
}

function parseOrganizationWebsite(metadata: string | null): string {
  if (!metadata) return "";
  try {
    const parsed = organizationMetadataSchema.safeParse(JSON.parse(metadata));
    return parsed.success ? (parsed.data.website ?? "") : "";
  } catch {
    return "";
  }
}

/** Pending and historical invitations for a workspace. */
export async function listChiefOrganizationInvitations(
  database: D1Database,
  organizationId: string,
): Promise<ChiefOrganizationInvitation[]> {
  const rows = await drizzle(database)
    .select({
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      status: invitation.status,
      expiresAt: invitation.expiresAt,
      createdAt: invitation.createdAt,
      inviterId: invitation.inviterId,
    })
    .from(invitation)
    .where(eq(invitation.organizationId, organizationId));
  return rows.map((row) => ({
    id: row.id,
    email: row.email,
    role: row.role ?? "member",
    status: toInvitationStatus(row.status),
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    inviterId: row.inviterId,
  }));
}

async function findMemberIdByEmail(
  database: D1Database,
  organizationId: string,
  email: string,
) {
  const rows = await drizzle(database)
    .select({ id: member.id })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(
      and(eq(member.organizationId, organizationId), eq(user.email, email)),
    )
    .limit(1);
  return rows[0]?.id ?? null;
}

/**
 * Creates a pending invitation, extending the expiry of an existing pending
 * invitation for the same address. Matches the row shape Better Auth's own
 * accept-invitation flow reads.
 */
export async function createChiefOrganizationInvitation(
  database: D1Database,
  input: {
    organizationId: string;
    email: string;
    role: "admin" | "member";
    inviterId: string;
    expiresInSeconds?: number;
  },
): Promise<ChiefInvitationResult> {
  const db = drizzle(database);
  const email = input.email.trim().toLowerCase();
  if (await findMemberIdByEmail(database, input.organizationId, email)) {
    return { ok: false, reason: "member_exists" };
  }
  const now = new Date();
  const expiresAt = new Date(
    now.getTime() + (input.expiresInSeconds ?? invitationExpirySeconds) * 1_000,
  );
  const pending = await db
    .select({ id: invitation.id, createdAt: invitation.createdAt })
    .from(invitation)
    .where(
      and(
        eq(invitation.organizationId, input.organizationId),
        eq(invitation.email, email),
        eq(invitation.status, "pending"),
      ),
    )
    .limit(1);
  const existing = pending[0];
  if (existing) {
    await db
      .update(invitation)
      .set({ role: input.role, expiresAt })
      .where(eq(invitation.id, existing.id));
    return {
      ok: true,
      invitation: {
        id: existing.id,
        email,
        role: input.role,
        status: "pending",
        expiresAt,
        createdAt: existing.createdAt,
        inviterId: input.inviterId,
      },
    };
  }
  const id = crypto.randomUUID();
  const createdAt = new Date();
  await db.insert(invitation).values({
    id,
    organizationId: input.organizationId,
    email,
    role: input.role,
    status: "pending",
    expiresAt,
    createdAt,
    inviterId: input.inviterId,
  });
  return {
    ok: true,
    invitation: {
      id,
      email,
      role: input.role,
      status: "pending",
      expiresAt,
      createdAt,
      inviterId: input.inviterId,
    },
  };
}

/** Cancels a pending invitation. Returns false when none matched. */
export async function cancelChiefOrganizationInvitation(
  database: D1Database,
  input: { organizationId: string; invitationId: string },
) {
  const db = drizzle(database);
  const existing = await db
    .select({ id: invitation.id })
    .from(invitation)
    .where(
      and(
        eq(invitation.id, input.invitationId),
        eq(invitation.organizationId, input.organizationId),
        eq(invitation.status, "pending"),
      ),
    )
    .limit(1);
  if (existing.length === 0) return false;
  await db
    .update(invitation)
    .set({ status: "canceled" })
    .where(eq(invitation.id, input.invitationId));
  return true;
}

function toInvitationStatus(
  value: string,
): "pending" | "accepted" | "rejected" | "canceled" {
  return value === "accepted" || value === "rejected" || value === "canceled"
    ? value
    : "pending";
}

export { getOrganizationSettings } from "./queries/get-organization-settings";
export { updateOrganizationSettings } from "./queries/update-organization-settings";
