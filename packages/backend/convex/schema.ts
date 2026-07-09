import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * Cloud state for durable/remote features: agent definitions, chat history
 * mirrors, schedules, connected channels and content drafts. The local
 * runtime remains the execution engine; Convex is the sync + durability
 * layer so agents are reachable when you're away from the machine.
 *
 * There is no workspace table: a "workspace" IS the better-auth organization
 * (owned by the betterAuth component on this deployment). Rows carry
 * `organizationId` — the org id minted by better-auth and present in every
 * JWT payload — so data is scoped per company without duplicating the org
 * concept.
 */
export default defineSchema({
  agent: defineTable({
    organizationId: v.string(),
    agentKey: v.string(), // stable id, e.g. "cmo"
    name: v.string(),
    role: v.string(),
    description: v.string(),
    instructions: v.string(),
    driver: v.union(v.literal("claude"), v.literal("codex")),
    model: v.optional(v.string()),
    delegates: v.optional(v.array(v.string())),
    enabled: v.boolean(),
  })
    .index("by_organization", ["organizationId"])
    .index("by_organization_key", ["organizationId", "agentKey"]),

  chat: defineTable({
    organizationId: v.string(),
    agentKey: v.string(),
    title: v.optional(v.string()),
    /** Backend-native session id (claude session / codex thread) for resume. */
    runtimeSessionId: v.optional(v.string()),
    lastMessageAt: v.number(),
  }).index("by_organization_agent", [
    "organizationId",
    "agentKey",
    "lastMessageAt",
  ]),

  message: defineTable({
    chatId: v.id("chat"),
    role: v.union(v.literal("user"), v.literal("assistant")),
    /** Normalized ContentBlock[] from the runtime, stored as JSON. */
    content: v.string(),
    costUsd: v.optional(v.number()),
  }).index("by_chat", ["chatId"]),

  schedule: defineTable({
    organizationId: v.string(),
    agentKey: v.string(),
    /** Natural-language description of the job, given to the agent as prompt. */
    prompt: v.string(),
    cron: v.string(),
    enabled: v.boolean(),
    lastRunAt: v.optional(v.number()),
  }).index("by_organization", ["organizationId"]),

  channel: defineTable({
    organizationId: v.string(),
    provider: v.string(), // "google-analytics" | "google-ads" | "x" | "reddit" | ...
    displayName: v.string(),
    status: v.union(
      v.literal("connected"),
      v.literal("disconnected"),
      v.literal("error"),
    ),
    /** Provider account/property identifier — never store tokens here. */
    externalId: v.optional(v.string()),
  }).index("by_organization", ["organizationId"]),

  draft: defineTable({
    organizationId: v.string(),
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
  }).index("by_organization_status", ["organizationId", "status"]),
});
