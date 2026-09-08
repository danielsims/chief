import { and, eq, exists, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import { member, organization } from "../schema/sqlite";

export async function updateOrganizationSettings(
  database: D1Database,
  input: {
    workspaceId: string;
    userId: string;
    name: string;
    website: string;
    imageURL: string | null;
  },
): Promise<{ id: string } | undefined> {
  const db = drizzle(database);
  const owner = db
    .select({ id: member.id })
    .from(member)
    .where(
      and(
        eq(member.organizationId, input.workspaceId),
        eq(member.userId, input.userId),
        eq(member.role, "owner"),
      ),
    );
  return db
    .update(organization)
    .set({
      name: input.name,
      logo: input.imageURL,
      metadata: sql`json_set(CASE WHEN json_valid(${organization.metadata}) THEN ${organization.metadata} ELSE '{}' END, '$.websiteUrl', ${input.website}, '$.website', ${input.website}, '$.logoSource', ${input.imageURL ? "upload" : "favicon"})`,
    })
    .where(and(eq(organization.id, input.workspaceId), exists(owner)))
    .returning({ id: organization.id })
    .get();
}
