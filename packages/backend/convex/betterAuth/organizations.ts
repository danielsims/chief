import { v } from "convex/values";

import { query } from "./_generated/server";

/**
 * Gets the user's default organization (first membership).
 * Used for finding what org to set as active during session creation.
 *
 * SECURITY: This is a public query called from database hooks.
 * Risk is limited - only returns orgId, not sensitive data.
 * The orgId alone doesn't grant any access.
 */
export const getUserDefaultOrganization = query({
  args: {
    userId: v.string(),
  },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args) => {
    const membership = await ctx.db
      .query("member")
      .withIndex("userId", (q) => q.eq("userId", args.userId))
      .first();

    return membership?.organizationId ?? null;
  },
});
