import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireOrganizationId } from "./lib/auth";

export const listRange = query({
  args: { start: v.number(), end: v.number() },
  handler: async (ctx, args) => {
    const organizationId = await requireOrganizationId(ctx);
    const statuses = ["draft", "approved", "scheduled", "published"] as const;
    const groups = await Promise.all(
      statuses.map((status) =>
        ctx.db
          .query("draft")
          .withIndex("by_organization_status", (q) =>
            q.eq("organizationId", organizationId).eq("status", status),
          )
          .collect(),
      ),
    );
    return groups
      .flat()
      .filter(
        (draft) =>
          draft.scheduledFor !== undefined &&
          draft.scheduledFor >= args.start &&
          draft.scheduledFor <= args.end,
      )
      .sort((a, b) => a.scheduledFor! - b.scheduledFor!);
  },
});

export const countUpcoming = query({
  args: {},
  handler: async (ctx) => {
    const organizationId = await requireOrganizationId(ctx);
    const drafts = await ctx.db
      .query("draft")
      .withIndex("by_organization_status", (q) =>
        q.eq("organizationId", organizationId).eq("status", "scheduled"),
      )
      .collect();
    const now = Date.now();
    return drafts.filter(
      (draft) => draft.scheduledFor !== undefined && draft.scheduledFor >= now,
    ).length;
  },
});
