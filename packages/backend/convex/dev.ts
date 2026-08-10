import { v } from "convex/values";

import type { TableNames } from "./_generated/dataModel";
import { components } from "./_generated/api";
import { internalMutation } from "./_generated/server";

/**
 * Dev-only full reset: wipes every app table and all better-auth data
 * except signing keys, so the next sign-in behaves like a brand-new
 * account. Run with: npx convex run dev:resetOnboarding
 */

const APP_TABLES: TableNames[] = [
  "socialAccount",
  "channel",
  "analyticsSnapshot",
  "agentCapability",
  "subscription",
  "stripeWebhookEvent",
];

/** Everything except jwks (JWT signing keys the deployment still needs). */
const AUTH_MODELS = [
  "invitation",
  "member",
  "organization",
  "session",
  "deviceCode",
  "verification",
  "account",
  "user",
];

/** Wipes only integration connections so connect flows can be retested
 * without losing the account or onboarding answers. */
export const clearConnections = internalMutation({
  args: {},
  handler: async (ctx) => {
    const tables: TableNames[] = [
      "channel",
      "analyticsSnapshot",
      "agentCapability",
    ];
    const deleted: Record<string, number> = {};
    for (const table of tables) {
      const docs = await ctx.db.query(table).collect();
      for (const doc of docs) {
        await ctx.db.delete(doc._id);
      }
      deleted[table] = docs.length;
    }
    return deleted;
  },
});

/** Backfill provider history from a locally verified read without storing the
 * machine credential in Convex. Existing points win only when the new read
 * does not include that date. */
export const seedAnalyticsSeries = internalMutation({
  args: {
    organizationId: v.string(),
    provider: v.string(),
    series: v.array(v.object({ date: v.string(), value: v.number() })),
  },
  handler: async (ctx, args) => {
    const snapshot = await ctx.db
      .query("analyticsSnapshot")
      .withIndex("by_organization_provider", (q) =>
        q
          .eq("organizationId", args.organizationId)
          .eq("provider", args.provider),
      )
      .unique();
    if (!snapshot) throw new Error("Analytics snapshot not found");
    const series = Array.from(
      new Map(
        [...(snapshot.series ?? []), ...args.series].map((point) => [
          point.date,
          point,
        ]),
      ).values(),
    )
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-370);
    await ctx.db.patch(snapshot._id, { series });
    return { count: series.length };
  },
});

export const seedAnalyticsRanges = internalMutation({
  args: {
    organizationId: v.string(),
    provider: v.string(),
    rangeMetrics: v.array(
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
  },
  handler: async (ctx, args) => {
    const snapshot = await ctx.db
      .query("analyticsSnapshot")
      .withIndex("by_organization_provider", (q) =>
        q
          .eq("organizationId", args.organizationId)
          .eq("provider", args.provider),
      )
      .unique();
    if (!snapshot) throw new Error("Analytics snapshot not found");
    const rangeMetrics = Array.from(
      new Map(
        [...(snapshot.rangeMetrics ?? []), ...args.rangeMetrics].map(
          (range) => [range.key, range],
        ),
      ).values(),
    );
    await ctx.db.patch(snapshot._id, { rangeMetrics });
    return { count: rangeMetrics.length };
  },
});

export const resetOnboarding = internalMutation({
  args: {},
  handler: async (ctx) => {
    const deleted: Record<string, number> = {};

    for (const table of APP_TABLES) {
      const docs = await ctx.db.query(table).collect();
      for (const doc of docs) {
        await ctx.db.delete(doc._id);
      }
      deleted[table] = docs.length;
    }

    for (const model of AUTH_MODELS) {
      let cursor: string | null = null;
      let isDone = false;
      let count = 0;
      while (!isDone) {
        const result: {
          count: number;
          isDone: boolean;
          continueCursor: string;
        } = await ctx.runMutation(components.betterAuth.adapter.deleteMany, {
          input: { model: model as never },
          paginationOpts: { numItems: 200, cursor },
        });
        count += result.count;
        isDone = result.isDone;
        cursor = result.continueCursor;
      }
      deleted[`betterAuth:${model}`] = count;
    }

    return deleted;
  },
});
