import { z } from "zod";

import { commandEnvelopeSchema, eventEnvelopeSchema } from "./envelopes";
import {
  agentIdSchema,
  conversationIdSchema,
  isoDateTimeSchema,
  messageIdSchema,
  userIdSchema,
  workspaceIdSchema,
} from "./identifiers";
import { principalSchema } from "./identity";

export const messageAuthorSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("user"), id: userIdSchema }),
  z.object({ kind: z.literal("agent"), id: agentIdSchema }),
  z.object({ kind: z.literal("system"), id: z.literal("chief-relay") }),
]);

export const messageComponentSchema = z
  .object({
    id: z.string().trim().min(1).max(128),
    kind: z.string().trim().min(1).max(64),
    version: z.int().positive(),
    payload: z.record(z.string(), z.unknown()),
  })
  .strict();

export const conversationMessageSchema = z.object({
  id: messageIdSchema,
  workspaceId: workspaceIdSchema,
  conversationId: conversationIdSchema,
  threadRootId: messageIdSchema.optional(),
  author: messageAuthorSchema,
  body: z.string().max(100_000),
  mentions: z.array(agentIdSchema).max(16).default([]),
  components: z.array(messageComponentSchema).max(32).default([]),
  createdAt: isoDateTimeSchema,
  sequence: z.int().nonnegative(),
});

export const appendMessagePayloadSchema = z
  .object({
    messageId: messageIdSchema,
    conversationId: conversationIdSchema,
    threadRootId: messageIdSchema.optional(),
    body: z.string().max(100_000),
    mentions: z.array(agentIdSchema).max(16).default([]),
    components: z.array(messageComponentSchema).max(32).default([]),
  })
  .strict();

export const appendMessageCommandSchema = commandEnvelopeSchema(
  appendMessagePayloadSchema,
);

export const messageAppendedEventSchema = eventEnvelopeSchema(
  z.object({ message: conversationMessageSchema }),
);

export const conversationSchema = z.object({
  id: conversationIdSchema,
  workspaceId: workspaceIdSchema,
  kind: z.enum(["channel", "direct"]),
  name: z.string().trim().min(1).max(128),
  createdAt: isoDateTimeSchema,
});

export const createConversationPayloadSchema = conversationSchema.pick({
  id: true,
  kind: true,
  name: true,
});

export const createConversationCommandSchema = commandEnvelopeSchema(
  createConversationPayloadSchema,
);

export const appendMessageResultSchema = z.object({
  duplicate: z.boolean(),
  message: conversationMessageSchema,
});

export const messagePageSchema = z.object({
  messages: z.array(conversationMessageSchema),
  nextSequence: z.int().nonnegative().nullable(),
});

export const conversationEventSchema = messageAppendedEventSchema;

export const conversationEventPageSchema = z.object({
  events: z.array(conversationEventSchema),
  nextSequence: z.int().nonnegative().nullable(),
});

export const socketTicketSchema = z
  .object({
    ticket: z.string().min(43).max(128),
    expiresAt: isoDateTimeSchema,
  })
  .strict();

export const trustedCommandContextSchema = z.object({
  actor: principalSchema,
  requestId: z.string().trim().min(1).max(128),
});

export type MessageAuthor = z.infer<typeof messageAuthorSchema>;
export type MessageComponent = z.infer<typeof messageComponentSchema>;
export type ConversationMessage = z.infer<typeof conversationMessageSchema>;
export type AppendMessageCommand = z.infer<typeof appendMessageCommandSchema>;
export type AppendMessageResult = z.infer<typeof appendMessageResultSchema>;
export type ConversationEvent = z.infer<typeof conversationEventSchema>;
export type Conversation = z.infer<typeof conversationSchema>;
export type TrustedCommandContext = z.infer<typeof trustedCommandContextSchema>;
