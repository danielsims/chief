import { getOrganizationSettings } from "@chief/auth/d1-organizations";
import { isJsonString, parseJsonObject } from "@chief/relay-contracts";

export async function readWorkspaceSettings(env: Env, workspaceId: string) {
  const row = await getOrganizationSettings(env.AUTH_DB, workspaceId);
  if (!row) return undefined;
  let website = "";
  try {
    const metadata = row.metadata
      ? parseJsonObject(JSON.parse(row.metadata))
      : null;
    website = isJsonString(metadata?.websiteUrl)
      ? metadata.websiteUrl
      : isJsonString(metadata?.website)
        ? metadata.website
        : "";
  } catch {
    /* Legacy malformed metadata must not hide an otherwise valid workspace. */
  }
  return { name: row.name, website, imageURL: row.imageURL };
}
