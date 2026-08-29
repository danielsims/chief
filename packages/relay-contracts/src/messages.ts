import { z } from "zod";

import { commandEnvelopeSchema, eventEnvelopeSchema } from "./envelopes";
import {
  agentIdSchema,
  conversationIdSchema,
  hexPubkeySchema,
  isoDateTimeSchema,
  messageIdSchema,
  userIdSchema,
  workspaceIdSchema,
} from "./identifiers";
import { principalSchema } from "./identity";
import { jsonObjectSchema } from "./json";

export const messageAuthorSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("user"), id: userIdSchema }),
  z.object({ kind: z.literal("agent"), id: agentIdSchema }),
  z.object({ kind: z.literal("system"), id: z.literal("chief-relay") }),
]);

export const pluginStatusSchema = z.enum([
  "available",
  "installed",
  "authorization_required",
  "waiting",
  "connected",
  "failed",
  "reconnect",
  "error",
]);

/**
 * Plugin cards deliberately use a flat, portable payload. Swift and
 * TypeScript consume the same relay component without provider-specific tool
 * result parsing, while placement and ownership stay explicit on the card.
 */
export const pluginRecommendationPayloadSchema = z
  .object({
    workspaceId: workspaceIdSchema,
    conversationId: conversationIdSchema,
    threadRootId: messageIdSchema.optional(),
    agentId: agentIdSchema,
    pluginId: z.string().trim().min(1).max(128),
    name: z.string().trim().min(1).max(256),
    description: z.string().trim().min(1).max(2_000),
    category: z.string().trim().min(1).max(128),
    sourceType: z.enum(["bundled", "git", "discovery", "setup"]),
    status: pluginStatusSchema,
    enabled: z.boolean(),
    trusted: z.boolean(),
    homepage: z.url().max(2_048).optional(),
    iconUrl: z.url().max(2_048).optional(),
    domain: z.string().trim().min(1).max(253).optional(),
    rationale: z.string().trim().min(1).max(1_000).optional(),
  })
  .strict();

export const channelMemberAddedPayloadSchema = z
  .object({
    type: z.literal("member-added"),
    actorId: z.string().trim().min(1).max(128),
    actorName: z.string().trim().min(1).max(256),
    actorType: z.enum(["agent", "user"]),
    targetId: z.string().trim().min(1).max(128),
    targetKind: z.enum(["agent", "user"]),
    targetName: z.string().trim().min(1).max(256),
    targetIds: z.string().max(2_048),
    targetNames: z.string().max(4_096),
    agentIds: z.string().max(2_048),
    userIds: z.string().max(2_048),
  })
  .strict();

const pluginAuthorizationPayloadBaseSchema = z.object({
  workspaceId: workspaceIdSchema,
  conversationId: conversationIdSchema,
  threadRootId: messageIdSchema.optional(),
  agentId: agentIdSchema,
  pluginId: z.string().trim().min(1).max(128),
  pluginName: z.string().trim().min(1).max(256),
  description: z.string().trim().min(1).max(2_000),
  provider: z.string().trim().min(1).max(256),
});

const externalUrlSchema = z
  .url()
  .max(2_048)
  .refine((value) => {
    const url = new URL(value);
    return (
      url.protocol === "https:" ||
      (url.protocol === "http:" &&
        ["127.0.0.1", "localhost"].includes(url.hostname))
    );
  }, "URLs must use HTTPS or a loopback address.");

export const pluginAuthorizationPayloadSchema = z.union([
  pluginAuthorizationPayloadBaseSchema
    .extend({
      kind: z.literal("plugin_authorization").optional(),
      authorizationUrl: externalUrlSchema,
      status: z.literal("authorization_required"),
    })
    .strict(),
  pluginAuthorizationPayloadBaseSchema
    .extend({
      kind: z.literal("plugin_oauth_client"),
      serverName: z.string().trim().min(1).max(256),
      callbackUrl: externalUrlSchema,
      setupUrl: externalUrlSchema.optional(),
      status: z.literal("client_configuration_required"),
    })
    .strict(),
]);

export const messageComponentSchema = z
  .object({
    id: z.string().trim().min(1).max(128),
    kind: z.string().trim().min(1).max(64),
    version: z.int().positive(),
    payload: jsonObjectSchema,
  })
  .strict()
  .superRefine((component, context) => {
    const schema =
      component.kind === "plugin.recommendation"
        ? pluginRecommendationPayloadSchema
        : component.kind === "plugin.authorization"
          ? pluginAuthorizationPayloadSchema
          : component.kind === "channel-action"
            ? channelMemberAddedPayloadSchema
            : undefined;
    if (!schema) return;
    const result = schema.safeParse(component.payload);
    if (component.version !== 1) {
      context.addIssue({
        code: "custom",
        path: ["version"],
        message: `${component.kind} only supports version 1.`,
      });
    }
    for (const issue of result.error?.issues ?? []) {
      context.addIssue({
        code: "custom",
        path: ["payload", ...issue.path],
        message: issue.message,
      });
    }
  });

const activityCorrelationSchema = {
  runId: z.string().trim().min(1).max(128).optional(),
  jobId: z.string().trim().min(1).max(128).optional(),
  providerSessionId: z.string().trim().min(1).max(256).optional(),
} as const;

/**
 * Activity components are deliberately narrower than ordinary rich message
 * components. The relay accepts only the current version and the portable
 * string payload understood by both the TypeScript and Swift hosts.
 */
export const agentActivityComponentSchema = z.discriminatedUnion("kind", [
  z
    .object({
      id: z.string().trim().min(1).max(128),
      kind: z.literal("thinking"),
      version: z.literal(1),
      payload: z
        .object({
          text: z.string().max(100_000),
          status: z.enum(["working", "completed"]),
          ...activityCorrelationSchema,
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      id: z.string().trim().min(1).max(128),
      kind: z.literal("tool"),
      version: z.literal(1),
      payload: z
        .object({
          name: z.string().trim().min(1).max(256),
          status: z.enum(["running", "completed", "failed"]),
          input: z.string().max(100_000).optional(),
          output: z.string().max(100_000).optional(),
          error: z.string().max(100_000).optional(),
          ...activityCorrelationSchema,
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      id: z.string().trim().min(1).max(128),
      kind: z.literal("error"),
      version: z.literal(1),
      payload: z
        .object({
          code: z.string().trim().min(1).max(128),
          title: z.string().trim().min(1).max(256),
          message: z.string().trim().min(1).max(4_000),
          retryable: z.enum(["true", "false"]),
          ...activityCorrelationSchema,
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      id: z.string().trim().min(1).max(128),
      kind: z.literal("browser"),
      version: z.literal(1),
      payload: z
        .object({
          browserRunId: z.string().trim().min(1).max(128),
          status: z.enum(["active", "closed"]),
          url: z.string().max(2_048).optional(),
          streamUrl: z.url().max(4_096).optional(),
          expiresAt: isoDateTimeSchema.optional(),
          ...activityCorrelationSchema,
        })
        .strict(),
    })
    .strict(),
]);

export const messageReactionSchema = z
  .object({
    emoji: z.string().trim().min(1).max(64),
    pubkeys: z.array(hexPubkeySchema).max(128).default([]),
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
  reactions: z.array(messageReactionSchema).default([]),
  edited: z.boolean().default(false),
  deleted: z.boolean().default(false),
  createdAt: isoDateTimeSchema,
  sequence: z.int().nonnegative(),
});

export const editMessagePayloadSchema = z
  .object({
    messageId: messageIdSchema,
    body: z.string().max(100_000),
  })
  .strict();

export const editMessageCommandSchema = commandEnvelopeSchema(
  editMessagePayloadSchema,
);

export const deleteMessagePayloadSchema = z
  .object({ messageId: messageIdSchema })
  .strict();

export const deleteMessageCommandSchema = commandEnvelopeSchema(
  deleteMessagePayloadSchema,
);

export const editMessageResultSchema = z
  .object({ message: conversationMessageSchema })
  .strict();

export const deleteMessageResultSchema = z
  .object({ message: conversationMessageSchema })
  .strict();

export const reactToMessagePayloadSchema = z
  .object({
    messageId: messageIdSchema,
    emoji: z.string().trim().min(1).max(64),
  })
  .strict();

export const reactToMessageResultSchema = z.object({
  add: z.boolean(),
  message: conversationMessageSchema,
});

export const messageReactionsResultSchema = z
  .object({ reactions: z.array(messageReactionSchema) })
  .strict();

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

/**
 * A cell-owned activity projection. The stable message id lets a cell replace
 * a streaming thinking/tool snapshot without appending a new chat message for
 * every token. Only keyed agent principals may write this route.
 */
export const upsertAgentActivityPayloadSchema = z
  .object({
    messageId: messageIdSchema,
    conversationId: conversationIdSchema,
    threadRootId: messageIdSchema.optional(),
    component: agentActivityComponentSchema,
  })
  .strict();

export const upsertAgentActivityResultSchema = z
  .object({
    created: z.boolean(),
    message: conversationMessageSchema,
  })
  .strict();

export const messageAppendedEventSchema = eventEnvelopeSchema(
  z.object({ message: conversationMessageSchema }),
).extend({ type: z.literal("conversation.message.appended") });

export const messageReactedEventSchema = eventEnvelopeSchema(
  z.object({ message: conversationMessageSchema }),
).extend({ type: z.literal("conversation.message.reacted") });

export const messageEditedEventSchema = eventEnvelopeSchema(
  z.object({ message: conversationMessageSchema }),
).extend({ type: z.literal("conversation.message.edited") });

export const messageDeletedEventSchema = eventEnvelopeSchema(
  z.object({ message: conversationMessageSchema }),
).extend({ type: z.literal("conversation.message.deleted") });

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

export const conversationEventSchema = z.discriminatedUnion("type", [
  messageAppendedEventSchema,
  messageReactedEventSchema,
  messageEditedEventSchema,
  messageDeletedEventSchema,
]);

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

export const workspaceSocketTicketSchema = socketTicketSchema
  .extend({ cursor: z.int().nonnegative() })
  .strict();

export const trustedCommandContextSchema = z.object({
  actor: principalSchema,
  requestId: z.string().trim().min(1).max(128),
});

export type MessageAuthor = z.infer<typeof messageAuthorSchema>;
export type MessageComponent = z.infer<typeof messageComponentSchema>;
export type PluginRecommendationPayload = z.infer<
  typeof pluginRecommendationPayloadSchema
>;
export type PluginAuthorizationPayload = z.infer<
  typeof pluginAuthorizationPayloadSchema
>;
export type AgentActivityComponent = z.infer<
  typeof agentActivityComponentSchema
>;
export type MessageReaction = z.infer<typeof messageReactionSchema>;
export type ConversationMessage = z.infer<typeof conversationMessageSchema>;
export type AppendMessageCommand = z.infer<typeof appendMessageCommandSchema>;
export type AppendMessageResult = z.infer<typeof appendMessageResultSchema>;
export type UpsertAgentActivityPayload = z.infer<
  typeof upsertAgentActivityPayloadSchema
>;
export type UpsertAgentActivityResult = z.infer<
  typeof upsertAgentActivityResultSchema
>;
export type EditMessagePayload = z.infer<typeof editMessagePayloadSchema>;
export type DeleteMessagePayload = z.infer<typeof deleteMessagePayloadSchema>;
export type ConversationEvent = z.infer<typeof conversationEventSchema>;
export type Conversation = z.infer<typeof conversationSchema>;
export type TrustedCommandContext = z.infer<typeof trustedCommandContextSchema>;
