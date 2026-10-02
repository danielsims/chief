import { z } from "zod";

import {
  guestIdSchema,
  isoDateTimeSchema,
  messageIdSchema,
} from "./identifiers";

/** Wake on @mentions and replies in threads the guest is part of, or on
 * every new message in the channel. */
export const channelGuestWakeSchema = z.enum(["mentions", "all"]);

export const channelGuestStatusSchema = z.enum(["active", "removed"]);

const guestNameSchema = z
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

export const channelGuestJoinInputSchema = z
  .object({
    name: guestNameSchema,
    about: z.string().trim().min(1).max(280).optional(),
    wake: channelGuestWakeSchema.default("mentions"),
    webhook: channelGuestWebhookInputSchema.optional(),
    /** Public HTTPS image the relay copies once and hosts itself. */
    avatarUrl: z
      .url({ protocol: /^https$/u })
      .max(2_048)
      .optional(),
  })
  .strict();

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

/**
 * Whether outsiders can join a channel. Only external channels have a link;
 * public and private channels are never reachable from outside.
 */
export const channelExternalAccessSchema = z.discriminatedUnion("external", [
  z.object({ external: z.literal(false) }).strict(),
  z.object({ external: z.literal(true), url: z.url() }).strict(),
]);

export const channelExternalUpdateSchema = z
  .object({ external: z.boolean() })
  .strict();

export const channelGuestRemoveResultSchema = z
  .object({ removed: z.literal(true) })
  .strict();

export const channelGuestJoinResultSchema = z
  .object({
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
export type ChannelExternalAccess = z.infer<typeof channelExternalAccessSchema>;
