import { ConvexError } from "convex/values";

import type { MutationCtx, QueryCtx } from "../_generated/server";

/**
 * Resolve the caller's active organization from the better-auth JWT.
 *
 * The convex plugin's definePayload puts the session's activeOrganizationId
 * on the identity as `organizationId`; every workspace-scoped function must
 * go through this so data never bleeds between organizations.
 */
export async function requireOrganizationId(
  ctx: QueryCtx | MutationCtx,
): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new ConvexError({
      code: "UNAUTHENTICATED",
      message: "You must be signed in to access this resource",
    });
  }

  const organizationId = identity.organizationId as string | undefined;
  if (!organizationId) {
    throw new ConvexError({
      code: "NO_ORGANIZATION",
      message: "No active workspace. Sign out and back in.",
    });
  }

  return organizationId;
}
