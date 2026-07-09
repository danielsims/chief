import { internalMutation } from "./_generated/server";
import { components } from "./_generated/api";
import type { TableNames } from "./_generated/dataModel";

/**
 * Dev-only full reset: wipes every app table and all better-auth data
 * except signing keys, so the next sign-in behaves like a brand-new
 * account. Run with: npx convex run dev:resetOnboarding
 */

const APP_TABLES: TableNames[] = [
  "agent",
  "socialAccount",
  "chat",
  "message",
  "schedule",
  "channel",
  "oauthState",
  "credential",
  "draft",
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
