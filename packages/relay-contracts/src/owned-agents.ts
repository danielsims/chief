import { z } from "zod";

import {
  agentIdSchema,
  conversationIdSchema,
  hexPubkeySchema,
  isoDateTimeSchema,
  messageIdSchema,
  userIdSchema,
  workspaceIdSchema,
} from "./identifiers";
/**
 * Owned agents: outside agents (ChatGPT, Claude Code, Codex, a cloud agent on
 * its own machine) that join a workspace as an agent owned by one human
 * member, after that member approves the request. The handle shown to people
 * is `<owner username>:<agent name>`. It is always computed from the owner's
 * current username and the agent's name, and never stored or resolved as text.
 */

import { usernameSchema } from "./usernames";

/** The short name an agent chooses for itself, unique among its owner's agents. */
export const ownedAgentNameSchema = z
  .string()
  .trim()
  .regex(
    /^[a-z0-9](?:[a-z0-9-]{0,22}[a-z0-9])?$/u,
    "Agent names are 1 to 24 lowercase letters, digits or hyphens.",
  )
  .refine(
    (value) => !value.includes("--"),
    "Agent names cannot contain two hyphens in a row.",
  );

export const ownedAgentProviderSchema = z.enum([
  "chatgpt",
  "claude",
  "codex",
  "grok",
  "muse",
  "other",
]);

/** Unambiguous when read aloud or retyped: no vowels, no look-alike letters. */
export const OWNED_AGENT_USER_CODE_ALPHABET = "BCDFGHJKLMNPQRSTVWXZ";

export const ownedAgentUserCodeSchema = z
  .string()
  .regex(/^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$/u);

export function ownedAgentHandle(username: string, name: string) {
  return `${username}:${name}`;
}

/**
 * The connect code a member copies into the setup prompt. It carries no
 * authority: it only routes a pending request to that member's approval card.
 */
export const ownedAgentConnectCodeSchema = z
  .object({
    connectCode: z.string().min(32).max(1_024),
    connectionUrl: z.url().max(4096),
    expiresAt: isoDateTimeSchema,
    expiresInSeconds: z.int().positive(),
  })
  .strict();

/** What a connect code decodes to (base64url JSON). */
export const ownedAgentConnectCodePayloadSchema = z
  .object({
    relay: z.url().max(2_048),
    workspaceId: workspaceIdSchema,
    code: z.string().min(32).max(128),
  })
  .strict();

export const ownedAgentConnectCommandSchema = z
  .object({
    code: z.string().min(32).max(128),
    name: ownedAgentNameSchema,
    provider: ownedAgentProviderSchema.default("other"),
    publicKey: hexPubkeySchema,
  })
  .strict();

/** RFC 8628 device authorization response. */
export const ownedAgentConnectResultSchema = z
  .object({
    device_code: z.string().min(43).max(128),
    user_code: ownedAgentUserCodeSchema,
    expires_in: z.int().positive(),
    interval: z.int().positive(),
  })
  .strict();

export const ownedAgentTokenCommandSchema = z
  .object({ device_code: z.string().min(43).max(128) })
  .strict();

/** RFC 8628 token errors, returned as the relay error code with status 400. */
export const ownedAgentTokenErrorSchema = z.enum([
  "authorization_pending",
  "slow_down",
  "access_denied",
  "expired_token",
]);

export const ownedAgentTokenResultSchema = z
  .object({
    agentId: agentIdSchema,
    workspaceId: workspaceIdSchema,
    name: ownedAgentNameSchema,
    handle: z.string().min(3).max(64),
    ownerUserId: userIdSchema,
  })
  .strict();

export const ownedAgentChallengeSchema = z
  .object({
    challenge: z.string().min(43).max(128),
    expiresAt: isoDateTimeSchema,
  })
  .strict();

export const ownedAgentCredentialCommandSchema = z
  .object({ challenge: z.string().min(43).max(128) })
  .strict();

export const ownedAgentCredentialSchema = z
  .object({
    credential: z.string().min(32).max(4_096),
    expiresAt: isoDateTimeSchema,
  })
  .strict();

/** A request waiting for its member's decision, as the approval card shows it. */
export const ownedAgentRequestSchema = z
  .object({
    id: z.uuid(),
    name: ownedAgentNameSchema,
    provider: ownedAgentProviderSchema,
    handle: z.string().min(3).max(64),
    userCode: ownedAgentUserCodeSchema,
    createdAt: isoDateTimeSchema,
    expiresAt: isoDateTimeSchema,
  })
  .strict();

export const ownedAgentRequestListSchema = z
  .object({ requests: z.array(ownedAgentRequestSchema) })
  .strict();

export const ownedAgentChannelSchema = z
  .object({ id: conversationIdSchema, name: z.string().max(256) })
  .strict();

export const ownedAgentSchema = z
  .object({
    id: agentIdSchema,
    name: ownedAgentNameSchema,
    provider: ownedAgentProviderSchema,
    /** Null while the owner has no username, which approval prevents. */
    handle: z.string().min(3).max(64).nullable(),
    owner: z
      .object({
        userId: userIdSchema,
        username: usernameSchema.nullable(),
        name: z.string().max(256).nullable(),
      })
      .strict(),
    channels: z.array(ownedAgentChannelSchema),
    online: z.boolean(),
    createdAt: isoDateTimeSchema,
    lastSeenAt: isoDateTimeSchema.nullable(),
  })
  .strict();

export const ownedAgentListSchema = z
  .object({ agents: z.array(ownedAgentSchema) })
  .strict();

export const ownedAgentDecisionResultSchema = z
  .object({
    status: z.enum(["approved", "denied"]),
    agent: ownedAgentSchema.optional(),
  })
  .strict();

export const ownedAgentRevokedSchema = z
  .object({ id: agentIdSchema, revoked: z.literal(true) })
  .strict();

export const ownedAgentChannelResultSchema = z
  .object({
    agentId: agentIdSchema,
    channelId: conversationIdSchema,
    member: z.boolean(),
  })
  .strict();

/** What an owned agent learns about itself. */
export const ownedAgentSelfSchema = z
  .object({
    agentId: agentIdSchema,
    workspaceId: workspaceIdSchema,
    name: ownedAgentNameSchema,
    handle: z.string().min(3).max(64).nullable(),
    channels: z.array(ownedAgentChannelSchema),
  })
  .strict();

export const ownedAgentWakeReasonSchema = z.enum(["mention", "thread"]);

/**
 * A channel message as an owned agent reads it. The body is whatever a person
 * or another agent wrote: data to consider, never instructions to follow.
 */
export const ownedAgentMessageSchema = z
  .object({
    id: messageIdSchema,
    channel: ownedAgentChannelSchema,
    threadRootId: messageIdSchema.nullable(),
    author: z
      .object({
        kind: z.enum(["person", "agent", "system"]),
        name: z.string().max(256),
        you: z.boolean(),
      })
      .strict(),
    body: z.string().max(100_000),
    createdAt: isoDateTimeSchema,
    cursor: z.int().nonnegative(),
    wakeReason: ownedAgentWakeReasonSchema.nullable(),
  })
  .strict();

export const ownedAgentMessagePageSchema = z
  .object({
    messages: z.array(ownedAgentMessageSchema),
    cursor: z.int().nonnegative(),
    channels: z.array(ownedAgentChannelSchema),
  })
  .strict();

export const OWNED_AGENT_MESSAGE_MAX_LENGTH = 8_000;

export const ownedAgentPostCommandSchema = z
  .object({
    channelId: conversationIdSchema,
    body: z.string().trim().min(1).max(OWNED_AGENT_MESSAGE_MAX_LENGTH),
    threadRootId: messageIdSchema.optional(),
    idempotencyKey: z.uuid().optional(),
  })
  .strict();

export const ownedAgentPostResultSchema = z
  .object({
    id: messageIdSchema,
    channelId: conversationIdSchema,
    threadRootId: messageIdSchema.nullable(),
    cursor: z.int().nonnegative(),
  })
  .strict();

/** A one-time address for the wake socket. It never carries message text. */
export const ownedAgentSocketTicketSchema = z
  .object({ url: z.url().max(2_048), expiresAt: isoDateTimeSchema })
  .strict();

export const ownedAgentWakeSchema = z
  .object({ type: z.literal("wake"), cursor: z.int().nonnegative() })
  .strict();

export type OwnedAgentProvider = z.infer<typeof ownedAgentProviderSchema>;
export type OwnedAgent = z.infer<typeof ownedAgentSchema>;
export type OwnedAgentRequest = z.infer<typeof ownedAgentRequestSchema>;
export type OwnedAgentConnectCode = z.infer<typeof ownedAgentConnectCodeSchema>;
export type OwnedAgentMessage = z.infer<typeof ownedAgentMessageSchema>;
export type OwnedAgentPostCommand = z.infer<typeof ownedAgentPostCommandSchema>;
export type OwnedAgentChannel = z.infer<typeof ownedAgentChannelSchema>;
