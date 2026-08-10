import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  sessions: defineTable({
    publicId: v.string(),
    status: v.union(
      v.literal("running"),
      v.literal("completed"),
      v.literal("failed"),
      v.literal("cancelled"),
    ),
    model: v.string(),
    nextSequence: v.number(),
    messages: v.array(
      v.object({
        role: v.union(v.literal("user"), v.literal("assistant")),
        content: v.string(),
      }),
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_public_id", ["publicId"]),
  events: defineTable({
    sessionId: v.id("sessions"),
    sequence: v.number(),
    event: v.any(),
    createdAt: v.number(),
  }).index("by_session_sequence", ["sessionId", "sequence"]),
});
