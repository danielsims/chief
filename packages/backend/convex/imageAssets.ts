import { v } from "convex/values";
import { mutation, type MutationCtx } from "./_generated/server";

const kind = v.union(v.literal("profile"), v.literal("workspace"));

async function ownerFor(ctx: MutationCtx, assetKind: "profile" | "workspace") {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Not authenticated.");
  if (assetKind === "profile") return identity.subject;
  const organizationId = identity.organizationId as string | undefined;
  if (!organizationId) throw new Error("No active workspace.");
  return organizationId;
}

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    if (!(await ctx.auth.getUserIdentity()))
      throw new Error("Not authenticated.");
    return ctx.storage.generateUploadUrl();
  },
});

export const save = mutation({
  args: { kind, storageId: v.id("_storage") },
  handler: async (ctx, args) => {
    const ownerId = await ownerFor(ctx, args.kind);
    const url = await ctx.storage.getUrl(args.storageId);
    if (!url) throw new Error("Uploaded image was not found.");
    const existing = await ctx.db
      .query("imageAsset")
      .withIndex("by_owner_kind", (q) =>
        q.eq("ownerId", ownerId).eq("kind", args.kind),
      )
      .unique();
    const now = Date.now();
    if (existing) {
      if (existing.storageId !== args.storageId) {
        await ctx.storage.delete(existing.storageId);
      }
      await ctx.db.patch(existing._id, {
        storageId: args.storageId,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("imageAsset", {
        ownerId,
        kind: args.kind,
        storageId: args.storageId,
        createdAt: now,
        updatedAt: now,
      });
    }
    return { url };
  },
});

export const remove = mutation({
  args: { kind },
  handler: async (ctx, args) => {
    const ownerId = await ownerFor(ctx, args.kind);
    const existing = await ctx.db
      .query("imageAsset")
      .withIndex("by_owner_kind", (q) =>
        q.eq("ownerId", ownerId).eq("kind", args.kind),
      )
      .unique();
    if (!existing) return;
    await ctx.storage.delete(existing.storageId);
    await ctx.db.delete(existing._id);
  },
});
