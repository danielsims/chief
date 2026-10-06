import { z } from "zod";

import {
  guestMarkSchema,
  guestOperatorSchema,
  guestProviderSchema,
} from "./guest-profile";
import {
  guestIdSchema,
  isoDateTimeSchema,
  messageIdSchema,
} from "./identifiers";

/** Wake on @mentions and replies in threads the guest is part of, or on
 * every new message in the channel. */
export const channelGuestWakeSchema = z.enum(["mentions", "all"]);

export const channelGuestStatusSchema = z.enum(["active", "removed"]);

export const guestNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(60)
  .regex(
    /^[\p{L}\p{N}][\p{L}\p{N} ._'-]*$/u,
    "Use letters, numbers, spaces, dots, apostrophes, underscores or hyphens.",
  );

/** Outbound wake-up for agents with an inbound HTTP trigger, such as a Grok
 * Bot routine webhook or an OpenClaw `/hooks/agent` endpoint. */
export const channelGuestWebhookInputSchema = z
  .object({
    url: z.url({ protocol: /^https$/u }).max(2_048),
    /** Sent verbatim as the Authorization header, e.g. `Bearer crsr_…`. */
    authorization: z.string().trim().min(1).max(2_048).optional(),
  })
  .strict();

/**
 * A Grok Bot's own `profile.json`, sent as it is on disk. Only `name`,
 * `avatarShape` and `avatarColor` are read; every other field is discarded.
 */
export const grokBotProfileInputSchema = z.object({
  name: z.string().trim().max(80).optional(),
  avatarShape: z.string().trim().max(40).optional(),
  avatarColor: z.string().trim().max(40).optional(),
});

export const channelGuestJoinInputSchema = z
  .object({
    /** Optional when `grokProfile` carries the name. */
    name: guestNameSchema.optional(),
    about: z.string().trim().min(1).max(280).optional(),
    /** What you run on. Optional when `grokProfile` says you are a Grok Bot. */
    provider: guestProviderSchema.optional(),
    /** The model you run, e.g. `claude-opus-5-5`. */
    model: z.string().trim().min(1).max(80).optional(),
    wake: channelGuestWakeSchema.default("mentions"),
    webhook: channelGuestWebhookInputSchema.optional(),
    /** Public HTTPS image the relay copies once and hosts itself. */
    avatarUrl: z
      .url({ protocol: /^https$/u })
      .max(2_048)
      .optional(),
    grokProfile: grokBotProfileInputSchema.optional(),
  })
  .strict()
  .refine((input) => input.name ?? input.grokProfile?.name, {
    message: "Send `name`, or a `grokProfile` that has one.",
    path: ["name"],
  })
  .refine((input) => input.provider ?? input.grokProfile, {
    message: `Send \`provider\`: one of ${guestProviderSchema.options.join(", ")}.`,
    path: ["provider"],
  });

export const channelGuestDeliveryInputSchema = z
  .object({
    wake: channelGuestWakeSchema.optional(),
    webhook: channelGuestWebhookInputSchema.nullable().optional(),
  })
  .strict();

export const channelGuestSummarySchema = z
  .object({
    id: guestIdSchema,
    name: z.string(),
    about: z.string().nullable(),
    image: z.url().nullable(),
    provider: guestProviderSchema,
    model: z.string().nullable(),
    mark: guestMarkSchema.nullable(),
    /** Set only when a member's personal invite verified who it works for. */
    operator: guestOperatorSchema.nullable(),
    /** What people type after @ to mention it, such as `danielsims:grokbot`. */
    handle: z.string(),
    status: channelGuestStatusSchema,
    wake: channelGuestWakeSchema,
    delivery: z.enum(["webhook", "events", "poll"]),
    createdAt: isoDateTimeSchema,
    lastSeenAt: isoDateTimeSchema.nullable(),
  })
  .strict();

export const channelGuestListSchema = z
  .object({ guests: z.array(channelGuestSummarySchema) })
  .strict();

export const channelGuestRemoveResultSchema = z
  .object({ removed: z.literal(true) })
  .strict();

/** One thing a guest can do, described well enough to call without docs. */
export const guestToolSchema = z
  .object({
    name: z.string(),
    description: z.string(),
    method: z.enum(["GET", "POST", "PUT", "DELETE"]),
    url: z.url(),
    /** JSON Schema for the query (GET) or JSON body (everything else). */
    input: z.record(z.string(), z.json()),
  })
  .strict();

/** A member's single-use link that admits their own agent into a channel. */
export const channelGuestInviteSchema = z
  .object({ url: z.url(), expiresAt: isoDateTimeSchema })
  .strict();

export const channelGuestJoinResultSchema = z
  .object({
    /** How to behave here. Read it before anything else. */
    instructions: z.string(),
    guest: channelGuestSummarySchema,
    token: z.string().min(43),
    /** Verifies wake-up webhooks. Returned once, when a webhook is set. */
    webhookSigningSecret: z.string().optional(),
    api: z
      .object({
        base: z.url(),
        mcp: z.url(),
        /** The MCP endpoint with the credential built in, for clients that
         * only accept a URL. Treat it as a secret. */
        mcpWithToken: z.url(),
      })
      .strict(),
    tools: z.array(guestToolSchema),
    next: z.object({ tool: z.string(), why: z.string() }).strict(),
  })
  .strict();

export const channelGuestPostInputSchema = z
  .object({
    body: z.string().trim().min(1).max(8_000),
    threadRootId: messageIdSchema.optional(),
    /** Retrying with the same id returns the original message. */
    idempotencyKey: z.uuid().optional(),
  })
  .strict();

/** The guest-facing projection of a message. Workspace-internal ids for
 * people and agents are never exposed; authors are names. */
export const channelGuestMessageSchema = z
  .object({
    id: messageIdSchema,
    threadRootId: messageIdSchema.nullable(),
    author: z
      .object({
        kind: z.enum(["person", "agent", "guest", "system"]),
        name: z.string(),
        you: z.boolean(),
      })
      .strict(),
    body: z.string(),
    createdAt: isoDateTimeSchema,
    cursor: z.int().nonnegative(),
  })
  .strict();

export const channelGuestMessagePageSchema = z
  .object({
    messages: z.array(channelGuestMessageSchema),
    cursor: z.int().nonnegative(),
  })
  .strict();

export type ChannelGuestWake = z.infer<typeof channelGuestWakeSchema>;
export type ChannelGuestStatus = z.infer<typeof channelGuestStatusSchema>;
export type ChannelGuestSummary = z.infer<typeof channelGuestSummarySchema>;
export type ChannelGuestJoinInput = z.infer<typeof channelGuestJoinInputSchema>;
export type ChannelGuestJoinResult = z.infer<
  typeof channelGuestJoinResultSchema
>;
export type ChannelGuestMessage = z.infer<typeof channelGuestMessageSchema>;
export type ChannelGuestPostInput = z.infer<typeof channelGuestPostInputSchema>;
export type ChannelGuestDeliveryInput = z.infer<
  typeof channelGuestDeliveryInputSchema
>;
export type GuestTool = z.infer<typeof guestToolSchema>;
export type ChannelGuestInvite = z.infer<typeof channelGuestInviteSchema>;
