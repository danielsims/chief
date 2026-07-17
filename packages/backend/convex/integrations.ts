import { v } from "convex/values";

import type { MutationCtx } from "./_generated/server";
import { internalMutation, mutation, query } from "./_generated/server";
import { requireOrganizationId } from "./lib/auth";

interface ConnectedIntegration {
  organizationId: string;
  provider: string;
  category?: string;
  displayName?: string;
  externalId?: string;
}

async function upsertConnectedIntegration(
  ctx: MutationCtx,
  args: ConnectedIntegration,
) {
  const now = Date.now();
  const provider = args.provider.trim();
  const displayName = args.displayName?.trim() || provider;
  const existing = await ctx.db
    .query("channel")
    .withIndex("by_organization_provider", (q) =>
      q.eq("organizationId", args.organizationId).eq("provider", provider),
    )
    .unique();

  if (existing) {
    await ctx.db.patch(existing._id, {
      displayName,
      status: "connected",
      category: args.category ?? existing.category,
      externalId: args.externalId ?? existing.externalId,
      connectedAt: existing.connectedAt ?? now,
      error: undefined,
    });
    return existing._id;
  }

  return ctx.db.insert("channel", {
    organizationId: args.organizationId,
    provider,
    category: args.category,
    displayName,
    status: "connected",
    externalId: args.externalId,
    connectedAt: now,
  });
}

/**
 * Marks any integration as connected for the workspace. Providers are
 * integrations.sh domains (or a provider-specific id like
 * "google-analytics"). Only connection facts are stored here; credentials
 * live wherever the setup path put them (local machine, provider CLI
 * config), never in this table.
 */
export const markConnected = mutation({
  args: {
    provider: v.string(),
    category: v.optional(v.string()),
    displayName: v.optional(v.string()),
    externalId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const organizationId = await requireOrganizationId(ctx);
    return upsertConnectedIntegration(ctx, { ...args, organizationId });
  },
});

/** Workspace-capability variant used exclusively by the Executor tool API. */
export const markConnectedForOrganization = internalMutation({
  args: {
    organizationId: v.string(),
    provider: v.string(),
    category: v.optional(v.string()),
    displayName: v.optional(v.string()),
    externalId: v.optional(v.string()),
  },
  handler: (ctx, args) => upsertConnectedIntegration(ctx, args),
});

/** All connected channels for the workspace, optionally filtered by category. */
export const listConnected = query({
  args: { category: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const organizationId = await requireOrganizationId(ctx);
    const channels = await ctx.db
      .query("channel")
      .withIndex("by_organization", (q) =>
        q.eq("organizationId", organizationId),
      )
      .collect();
    return channels.filter(
      (channel) =>
        channel.status === "connected" &&
        (!args.category || channel.category === args.category),
    );
  },
});

export const disconnect = mutation({
  args: { provider: v.string() },
  handler: async (ctx, args) => {
    const organizationId = await requireOrganizationId(ctx);
    const channel = await ctx.db
      .query("channel")
      .withIndex("by_organization_provider", (q) =>
        q.eq("organizationId", organizationId).eq("provider", args.provider),
      )
      .unique();
    if (channel) {
      await ctx.db.patch(channel._id, {
        status: "disconnected",
        error: undefined,
      });
    }
  },
});
