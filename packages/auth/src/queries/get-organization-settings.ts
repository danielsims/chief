import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import { organization } from "../schema/sqlite";

export async function getOrganizationSettings(
  database: D1Database,
  workspaceId: string,
) {
  return drizzle(database)
    .select({
      name: organization.name,
      imageURL: organization.logo,
      metadata: organization.metadata,
    })
    .from(organization)
    .where(eq(organization.id, workspaceId))
    .get();
}
