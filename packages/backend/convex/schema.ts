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
  /**
   * Per-workspace overrides layered on top of the default agent registry
   * (packages/agent-runtime defaultAgents). Every field except the key is
   * optional: absent means "use the registry default".
   */
  agent: defineTable({
    organizationId: v.string(),
    agentKey: v.string(), // stable id, e.g. "cmo"
    name: v.optional(v.string()),
    role: v.optional(v.string()),
    description: v.optional(v.string()),
    instructions: v.optional(v.string()),
    driver: v.optional(
      v.union(v.literal("claude"), v.literal("codex"), v.literal("vercel")),
    ),
    model: v.optional(v.string()),
    delegates: v.optional(v.array(v.string())),
    enabled: v.optional(v.boolean()),
    /** Deployed Vercel-style agent endpoint (driver = "vercel"). */
    vercelUrl: v.optional(v.string()),
    vercelKey: v.optional(v.string()),
  })
    .index("by_organization", ["organizationId"])
    .index("by_organization_key", ["organizationId", "agentKey"]),

  /**
   * Social presence for a workspace. No OAuth: agents only draft and read
   * public pages, so a handle + canonical URL is all we store.
   */
  socialAccount: defineTable({
    organizationId: v.string(),
    platform: v.union(
      v.literal("x"),
      v.literal("instagram"),
      v.literal("linkedin"),
      v.literal("tiktok"),
      v.literal("youtube"),
      v.literal("reddit"),
    ),
    handle: v.string(),
    url: v.string(),
  })
    .index("by_organization", ["organizationId"])
    .index("by_organization_platform", ["organizationId", "platform"]),

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
    /** Product surface this connection powers: "analytics" | "ads" | "social" | ... */
    category: v.optional(v.string()),
    displayName: v.string(),
    status: v.union(
      v.literal("connected"),
      v.literal("disconnected"),
      v.literal("error"),
    ),
    /** Provider account/property identifier — never store tokens here. */
    externalId: v.optional(v.string()),
    connectedAt: v.optional(v.number()),
    lastSyncAt: v.optional(v.number()),
    error: v.optional(v.string()),
  })
    .index("by_organization", ["organizationId"])
    .index("by_organization_provider", ["organizationId", "provider"]),

  /** In-flight OAuth authorization state for any provider's connect flow. */
  oauthState: defineTable({
    state: v.string(),
    organizationId: v.string(),
    provider: v.string(),
    createdAt: v.number(),
    consumedAt: v.optional(v.number()),
    status: v.union(
      v.literal("pending"),
      v.literal("connected"),
      v.literal("error"),
    ),
    error: v.optional(v.string()),
  }).index("by_state", ["state"]),

  /**
   * OAuth tokens per workspace and provider, for cloud-track connections.
   * Local-track connections keep credentials on the user's machine and never
   * write here. externalId/externalName carry the provider's primary object
   * (a GA4 property, an ad account, ...).
   */
  credential: defineTable({
    organizationId: v.string(),
    provider: v.string(),
    accessToken: v.string(),
    refreshToken: v.optional(v.string()),
    expiresAt: v.optional(v.number()),
    scope: v.optional(v.string()),
    externalId: v.optional(v.string()),
    externalName: v.optional(v.string()),
    accountName: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_organization_provider", ["organizationId", "provider"]),

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

  /**
   * Stripe billing state, scoped to the better-auth organization. The row is
   * created lazily at Checkout/Portal time so we can reuse one Stripe customer
   * per workspace before Stripe has emitted subscription webhooks.
   */
  subscription: defineTable({
    organizationId: v.string(),
    stripeCustomerId: v.string(),
    stripeSubscriptionId: v.optional(v.string()),
    status: v.union(
      v.literal("trialing"),
      v.literal("active"),
      v.literal("past_due"),
      v.literal("canceled"),
      v.literal("incomplete"),
    ),
    priceId: v.optional(v.string()),
    currentPeriodStart: v.optional(v.number()),
    currentPeriodEnd: v.optional(v.number()),
    trialEnd: v.optional(v.number()),
    cancelAtPeriodEnd: v.optional(v.boolean()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_organization", ["organizationId"])
    .index("by_stripeCustomerId", ["stripeCustomerId"])
    .index("by_stripeSubscriptionId", ["stripeSubscriptionId"]),

  stripeWebhookEvent: defineTable({
    stripeEventId: v.string(),
    type: v.string(),
    processedAt: v.number(),
  }).index("by_stripeEventId", ["stripeEventId"]),
});
