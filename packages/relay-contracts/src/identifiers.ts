import { z } from "zod";

const identifier = z.string().trim().min(1).max(128);
const routedIdentifier = identifier.regex(
  /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u,
  "Identifiers may only contain letters, numbers, dots, underscores, and hyphens.",
);

export const workspaceIdSchema = routedIdentifier.brand<"WorkspaceId">();
export const conversationIdSchema = routedIdentifier.brand<"ConversationId">();
export const messageIdSchema = identifier.brand<"MessageId">();
export const agentIdSchema = routedIdentifier.brand<"AgentId">();
/** Workspace-scoped secret name: lowercase start, letters/digits/._- max 120. */
export const secretNameSchema = z
  .string()
  .trim()
  .regex(
    /^[a-z][a-z0-9._-]{0,119}$/u,
    "Secret names must start lowercase and use only letters, digits, dots, underscores, or dashes.",
  );
export const userIdSchema = identifier.brand<"UserId">();
/** Agent or user principal addressed by a channel @mention. */
export const channelMentionIdSchema = z.union([agentIdSchema, userIdSchema]);
export const commandIdSchema = z.uuid().brand<"CommandId">();
export const eventIdSchema = z.uuid().brand<"EventId">();
export const jobIdSchema = z.uuid().brand<"JobId">();
export const isoDateTimeSchema = z.iso.datetime({ offset: true });

/** 32-byte x-only secp256k1 public key as lowercase hex (nostr identity). */
export const hexPubkeySchema = z
  .string()
  .trim()
  .regex(/^[0-9a-f]{64}$/u, "A public key must be 32 bytes of lowercase hex.");

export type WorkspaceId = z.infer<typeof workspaceIdSchema>;
export type ConversationId = z.infer<typeof conversationIdSchema>;
export type MessageId = z.infer<typeof messageIdSchema>;
export type AgentId = z.infer<typeof agentIdSchema>;
export type UserId = z.infer<typeof userIdSchema>;
export type ChannelMentionId = z.infer<typeof channelMentionIdSchema>;
export type CommandId = z.infer<typeof commandIdSchema>;
export type EventId = z.infer<typeof eventIdSchema>;
export type JobId = z.infer<typeof jobIdSchema>;
export type HexPubkey = z.infer<typeof hexPubkeySchema>;
