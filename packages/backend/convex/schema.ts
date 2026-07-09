import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * Cloud state for durable/remote features: agent definitions, chat history
 * mirrors, schedules, connected channels and content drafts. The local
 * runtime remains the execution engine; Convex is the sync + durability
 * layer so agents are reachable when you're away from the machine.
 */
export default defineSchema({
  workspaces: defineTable({
    name: v.string(),
    slug: v.string(),
  }).index("by_slug", ["slug"]),

  agents: defineTable({
    workspaceId: v.id("workspaces"),
    agentKey: v.string(), // stable id, e.g. "cmo"
    name: v.string(),
    role: v.string(),
    description: v.string(),
    instructions: v.string(),
    driver: v.union(v.literal("claude"), v.literal("codex")),
    model: v.optional(v.string()),
    emoji: v.optional(v.string()),
    delegates: v.optional(v.array(v.string())),
    enabled: v.boolean(),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_workspace_key", ["workspaceId", "agentKey"]),

  chats: defineTable({
    workspaceId: v.id("workspaces"),
    agentKey: v.string(),
    title: v.optional(v.string()),
    /** Backend-native session id (claude session / codex thread) for resume. */
    runtimeSessionId: v.optional(v.string()),
    lastMessageAt: v.number(),
  }).index("by_workspace_agent", ["workspaceId", "agentKey", "lastMessageAt"]),

  messages: defineTable({
    chatId: v.id("chats"),
    role: v.union(v.literal("user"), v.literal("assistant")),
    /** Normalized ContentBlock[] from the runtime, stored as JSON. */
    content: v.string(),
    costUsd: v.optional(v.number()),
  }).index("by_chat", ["chatId"]),

  schedules: defineTable({
    workspaceId: v.id("workspaces"),
    agentKey: v.string(),
    /** Natural-language description of the job, given to the agent as prompt. */
    prompt: v.string(),
    cron: v.string(),
    enabled: v.boolean(),
    lastRunAt: v.optional(v.number()),
  }).index("by_workspace", ["workspaceId"]),

  channels: defineTable({
    workspaceId: v.id("workspaces"),
    provider: v.string(), // "google-analytics" | "google-ads" | "x" | "reddit" | ...
    displayName: v.string(),
    status: v.union(
      v.literal("connected"),
      v.literal("disconnected"),
      v.literal("error"),
    ),
    /** Provider account/property identifier — never store tokens here. */
    externalId: v.optional(v.string()),
  }).index("by_workspace", ["workspaceId"]),

  drafts: defineTable({
    workspaceId: v.id("workspaces"),
    agentKey: v.string(),
    kind: v.union(v.literal("text"), v.literal("image"), v.literal("video")),
    platform: v.string(),
    title: v.string(),
    body: v.string(),
    status: v.union(
      v.literal("draft"),
      v.literal("approved"),
      v.literal("scheduled"),
      v.literal("published"),
    ),
    scheduledFor: v.optional(v.number()),
  }).index("by_workspace_status", ["workspaceId", "status"]),
});
