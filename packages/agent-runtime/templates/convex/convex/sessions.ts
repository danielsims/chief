import { v } from "convex/values";

import type { Doc } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internalMutation, internalQuery } from "./_generated/server";

const lookup = (ctx: { db: QueryCtx["db"] }, publicId: string) =>
  ctx.db
    .query("sessions")
    .withIndex("by_public_id", (q) => q.eq("publicId", publicId))
    .unique();

async function pushEvent(
  ctx: MutationCtx,
  session: Doc<"sessions">,
  event: unknown,
) {
  await ctx.db.insert("events", {
    sessionId: session._id,
    sequence: session.nextSequence,
    event,
    createdAt: Date.now(),
  });
  await ctx.db.patch(session._id, {
    nextSequence: session.nextSequence + 1,
    updatedAt: Date.now(),
  });
}

export const start = internalMutation({
  args: {
    publicId: v.string(),
    prompt: v.string(),
    model: v.string(),
  },
  handler: async (ctx, args) => {
    let session = await lookup(ctx, args.publicId);
    if (session?.status === "running")
      throw new Error("Session is already running.");
    if (!session) {
      const id = await ctx.db.insert("sessions", {
        publicId: args.publicId,
        status: "running",
        model: args.model,
        nextSequence: 0,
        messages: [{ role: "user", content: args.prompt }],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      session = await ctx.db.get(id);
      if (!session) throw new Error("Could not create session.");
      await pushEvent(ctx, session, {
        type: "init",
        sessionId: args.publicId,
        model: args.model,
      });
      session = await ctx.db.get(id);
    } else {
      await ctx.db.patch(session._id, {
        status: "running",
        model: args.model,
        messages: [
          ...session.messages.slice(-39),
          { role: "user" as const, content: args.prompt },
        ],
        updatedAt: Date.now(),
      });
      session = await ctx.db.get(session._id);
    }
    if (!session) throw new Error("Could not start session.");
    await pushEvent(ctx, session, { type: "status", status: "running" });
    return args.publicId;
  },
});

export const append = internalMutation({
  args: { publicId: v.string(), event: v.any() },
  handler: async (ctx, args) => {
    const session = await lookup(ctx, args.publicId);
    if (!session) throw new Error("Session not found.");
    await pushEvent(ctx, session, args.event);
  },
});

export const finish = internalMutation({
  args: {
    publicId: v.string(),
    status: v.union(
      v.literal("completed"),
      v.literal("failed"),
      v.literal("cancelled"),
    ),
    text: v.optional(v.string()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    let session = await lookup(ctx, args.publicId);
    if (!session || session.status === "cancelled") return;
    if (args.text) {
      await ctx.db.patch(session._id, {
        messages: [
          ...session.messages.slice(-39),
          { role: "assistant" as const, content: args.text },
        ],
      });
      session = await ctx.db.get(session._id);
      if (!session) return;
      await pushEvent(ctx, session, {
        type: "message",
        id: `${args.publicId}-${session.nextSequence}`,
        role: "assistant",
        content: [{ type: "text", text: args.text }],
      });
      session = await ctx.db.get(session._id);
    }
    if (!session) return;
    await pushEvent(ctx, session, {
      type: "result",
      ok: args.status === "completed",
      error: args.error,
    });
    session = await ctx.db.get(session._id);
    if (!session) return;
    await pushEvent(ctx, session, { type: "status", status: "idle" });
    await ctx.db.patch(session._id, {
      status: args.status,
      updatedAt: Date.now(),
    });
  },
});

export const cancel = internalMutation({
  args: { publicId: v.string() },
  handler: async (ctx, args) => {
    let session = await lookup(ctx, args.publicId);
    if (session?.status !== "running") return false;
    await ctx.db.patch(session._id, {
      status: "cancelled",
      updatedAt: Date.now(),
    });
    session = await ctx.db.get(session._id);
    if (!session) return false;
    await pushEvent(ctx, session, {
      type: "result",
      ok: false,
      error: "Turn interrupted",
    });
    session = await ctx.db.get(session._id);
    if (session)
      await pushEvent(ctx, session, { type: "status", status: "idle" });
    return true;
  },
});

export const state = internalQuery({
  args: { publicId: v.string() },
  handler: async (ctx, args) => {
    const session = await lookup(ctx, args.publicId);
    if (!session) return null;
    return { status: session.status, messages: session.messages };
  },
});

export const events = internalQuery({
  args: { publicId: v.string(), after: v.number() },
  handler: async (ctx, args) => {
    const session = await lookup(ctx, args.publicId);
    if (!session) return null;
    const rows = await ctx.db
      .query("events")
      .withIndex("by_session_sequence", (q) =>
        q.eq("sessionId", session._id).gt("sequence", args.after),
      )
      .take(100);
    return {
      events: rows.map(({ sequence, event }) => ({
        cursor: sequence,
        // Convex's v.any() deliberately enters TypeScript as any at this boundary.
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        event,
      })),
      status: session.status,
    };
  },
});
