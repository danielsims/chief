import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireOrganizationId } from "./lib/auth";

const snapshotArgs = {
  provider: v.string(),
  period: v.string(),
  activeUsers: v.optional(v.number()),
  sessions: v.optional(v.number()),
  pageViews: v.optional(v.number()),
  conversions: v.optional(v.number()),
  revenue: v.optional(v.number()),
  metricLabel: v.optional(v.string()),
  series: v.optional(
    v.array(v.object({ date: v.string(), value: v.number() })),
  ),
  rangeMetrics: v.optional(
    v.array(
      v.object({
        key: v.string(),
        period: v.string(),
        activeUsers: v.optional(v.number()),
        sessions: v.optional(v.number()),
        pageViews: v.optional(v.number()),
        conversions: v.optional(v.number()),
        revenue: v.optional(v.number()),
      }),
    ),
  ),
};

export const getLatest = query({
  args: { provider: v.string() },
  handler: async (ctx, args) => {
    const organizationId = await requireOrganizationId(ctx);
    return ctx.db
      .query("analyticsSnapshot")
      .withIndex("by_organization_provider", (q) =>
        q.eq("organizationId", organizationId).eq("provider", args.provider),
      )
      .unique();
  },
});

export const listLatest = query({
  args: {},
  handler: async (ctx) => {
    const organizationId = await requireOrganizationId(ctx);
    return ctx.db
      .query("analyticsSnapshot")
      .withIndex("by_organization", (q) =>
        q.eq("organizationId", organizationId),
      )
      .collect();
  },
});

export const upsert = mutation({
  args: snapshotArgs,
  handler: async (ctx, args) => {
    const organizationId = await requireOrganizationId(ctx);
    const existing = await ctx.db
      .query("analyticsSnapshot")
      .withIndex("by_organization_provider", (q) =>
        q.eq("organizationId", organizationId).eq("provider", args.provider),
      )
      .unique();
    const value = {
      ...args,
      organizationId,
      capturedAt: Date.now(),
    };
    if (existing) {
      const series = args.series
        ? Array.from(
            new Map(
              [...(existing.series ?? []), ...args.series].map((point) => [
                point.date,
                point,
              ]),
            ).values(),
          )
            .sort((a, b) => a.date.localeCompare(b.date))
            .slice(-370)
        : existing.series;
      const rangeMetrics = args.rangeMetrics
        ? Array.from(
            new Map(
              [...(existing.rangeMetrics ?? []), ...args.rangeMetrics].map(
                (range) => [range.key, range],
              ),
            ).values(),
          )
        : existing.rangeMetrics;
      await ctx.db.patch(existing._id, { ...value, series, rangeMetrics });
      return existing._id;
    }
    return ctx.db.insert("analyticsSnapshot", value);
  },
});
