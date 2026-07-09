import { v } from "convex/values";

import { mutation, query } from "./_generated/server";
import { requireOrganizationId } from "./lib/auth";

/**
 * Per-workspace agent overrides. Definitions live in the agent registry
 * (packages/agent-runtime defaultAgents); rows here only carry deltas —
 * enable/disable, model override and the inference provider selection.
 */

export const listOverrides = query({
  args: {},
  handler: async (ctx) => {
    const organizationId = await requireOrganizationId(ctx);
    return ctx.db
      .query("agent")
      .withIndex("by_organization", (q) =>
        q.eq("organizationId", organizationId),
      )
      .collect();
  },
});

export const upsertOverride = mutation({
  args: {
    agentKey: v.string(),
    enabled: v.optional(v.boolean()),
    model: v.optional(v.string()),
    driver: v.optional(
      v.union(v.literal("claude"), v.literal("codex"), v.literal("vercel")),
    ),
    vercelUrl: v.optional(v.string()),
    vercelKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const organizationId = await requireOrganizationId(ctx);
    const { agentKey, ...patch } = args;

    // An empty string clears the override (patch with undefined removes the
    // field), falling back to the registry default.
    if (patch.model === "") patch.model = undefined;
    if (patch.vercelUrl === "") patch.vercelUrl = undefined;
    if (patch.vercelKey === "") patch.vercelKey = undefined;

    const existing = await ctx.db
      .query("agent")
      .withIndex("by_organization_key", (q) =>
        q.eq("organizationId", organizationId).eq("agentKey", agentKey),
      )
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return existing._id;
    }
    return ctx.db.insert("agent", {
      organizationId,
      agentKey,
      ...patch,
    });
  },
});
