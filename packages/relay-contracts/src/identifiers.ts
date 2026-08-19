import { z } from "zod";

const identifier = z.string().trim().min(1).max(128);

export const workspaceIdSchema = identifier.brand<"WorkspaceId">();
export const conversationIdSchema = identifier.brand<"ConversationId">();
export const messageIdSchema = identifier.brand<"MessageId">();
export const agentIdSchema = identifier.brand<"AgentId">();
export const userIdSchema = identifier.brand<"UserId">();
export const commandIdSchema = z.uuid().brand<"CommandId">();
export const eventIdSchema = z.uuid().brand<"EventId">();
export const jobIdSchema = z.uuid().brand<"JobId">();
export const isoDateTimeSchema = z.iso.datetime({ offset: true });

export type WorkspaceId = z.infer<typeof workspaceIdSchema>;
export type ConversationId = z.infer<typeof conversationIdSchema>;
export type MessageId = z.infer<typeof messageIdSchema>;
export type AgentId = z.infer<typeof agentIdSchema>;
export type UserId = z.infer<typeof userIdSchema>;
export type CommandId = z.infer<typeof commandIdSchema>;
export type EventId = z.infer<typeof eventIdSchema>;
export type JobId = z.infer<typeof jobIdSchema>;
