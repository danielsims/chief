import { v } from "convex/values";

import { mutation, query } from "./_generated/server";
import { requireOrganizationId } from "./lib/auth";

const socialPlatform = v.union(
  v.literal("x"),
  v.literal("instagram"),
  v.literal("linkedin"),
  v.literal("tiktok"),
  v.literal("youtube"),
  v.literal("reddit"),
);

/**
 * Canonical profile URL prefixes per platform. Mirrored in the desktop app
 * (apps/desktop/src/lib/social-platforms.ts) — the server derives the stored
 * URL so clients only ever send bare handles.
 */
const PLATFORM_PREFIXES: Record<string, string> = {
  x: "x.com/",
  instagram: "instagram.com/",
  linkedin: "linkedin.com/company/",
  tiktok: "tiktok.com/@",
  youtube: "youtube.com/@",
  reddit: "reddit.com/user/",
};

/** Strip @, slashes and full-URL pastes down to a bare handle. */
function sanitizeHandle(raw: string): string {
  let handle = raw.trim();
  handle = handle.replace(/^https?:\/\//i, "").replace(/^www\./i, "");
  for (const prefix of Object.values(PLATFORM_PREFIXES)) {
    if (handle.toLowerCase().startsWith(prefix.toLowerCase())) {
      handle = handle.slice(prefix.length);
      break;
    }
  }
  handle = handle.replace(/^[@/]+/, "");
  handle = handle.split("?")[0]?.split("#")[0] ?? "";
  return handle.replace(/\/+$/, "");
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    const organizationId = await requireOrganizationId(ctx);
    return ctx.db
      .query("socialAccount")
      .withIndex("by_organization", (q) =>
        q.eq("organizationId", organizationId),
      )
      .collect();
  },
});

export const upsert = mutation({
  args: {
    platform: socialPlatform,
    handle: v.string(),
  },
  handler: async (ctx, args) => {
    const organizationId = await requireOrganizationId(ctx);
    const handle = sanitizeHandle(args.handle);
    if (!handle) {
      throw new Error("Handle is empty after sanitization");
    }

    const url = `https://${PLATFORM_PREFIXES[args.platform]}${handle}`;
    const existing = await ctx.db
      .query("socialAccount")
      .withIndex("by_organization_platform", (q) =>
        q.eq("organizationId", organizationId).eq("platform", args.platform),
      )
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, { handle, url });
      return existing._id;
    }
    return ctx.db.insert("socialAccount", {
      organizationId,
      platform: args.platform,
      handle,
      url,
    });
  },
});

export const remove = mutation({
  args: {
    platform: socialPlatform,
  },
  handler: async (ctx, args) => {
    const organizationId = await requireOrganizationId(ctx);
    const existing = await ctx.db
      .query("socialAccount")
      .withIndex("by_organization_platform", (q) =>
        q.eq("organizationId", organizationId).eq("platform", args.platform),
      )
      .unique();
    if (existing) {
      await ctx.db.delete(existing._id);
    }
  },
});
