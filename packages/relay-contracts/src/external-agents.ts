import { z } from "zod";

import { commandEnvelopeSchema } from "./envelopes";
import {
  agentIdSchema,
  conversationIdSchema,
  messageIdSchema,
} from "./identifiers";
import { jsonObjectSchema } from "./json";
import { agentActivityComponentSchema } from "./messages";
import { agentSummarySchema } from "./workspaces";

export const externalAgentDefinitionInputSchema = z
  .object({
    kind: z.literal("project-repository"),
    projectId: z.string().trim().min(1).max(128),
    path: z
      .string()
      .trim()
      .min(1)
      .max(1_024)
      .refine(
        (path) =>
          !path.startsWith("/") &&
          !path.includes("\\") &&
          path
            .split("/")
            .every((segment) => segment !== ".." && segment !== ""),
        "Expected a repository-relative path without traversal.",
      ),
    ref: z.string().trim().min(1).max(512),
  })
  .strict();

export const externalAgentRegistrationPayloadSchema = z
  .object({
    agentId: agentIdSchema,
    name: z.string().trim().min(1).max(120),
    role: z.string().trim().min(1).max(120),
    description: z.string().trim().min(1).max(1_000).optional(),
    instructions: z.string().trim().min(1).max(40_000).optional(),
    endpoint: z.url().max(2_048),
    definition: externalAgentDefinitionInputSchema.optional(),
    replaceNative: z.boolean().default(false),
  })
  .strict();

export const registerExternalAgentCommandSchema = commandEnvelopeSchema(
  externalAgentRegistrationPayloadSchema,
);

export const externalAgentRegistrationResultSchema = z
  .object({
    agent: agentSummarySchema,
    channel: z
      .object({
        token: z.string().min(43).max(256),
        inboundUrl: z.url(),
        deliverySigningKeyId: z.string().trim().min(8).max(128),
        deliverySigningSecret: z.string().min(43).max(256),
      })
      .strict(),
  })
  .strict();

export const externalAgentDisconnectResultSchema = z
  .object({ disconnected: z.literal(true), agentId: agentIdSchema })
  .strict();

export const externalAgentEndpointUpdateSchema = z
  .object({ endpoint: z.url().max(2_048) })
  .strict();

export const externalAgentEndpointUpdateResultSchema = z
  .object({ updated: z.literal(true), agentId: agentIdSchema })
  .strict();

export const externalAgentCredentialRotationResultSchema = z
  .object({
    channel: z
      .object({
        token: z.string().min(43).max(256),
        inboundUrl: z.url(),
        deliverySigningKeyId: z.string().trim().min(8).max(128),
        deliverySigningSecret: z.string().min(43).max(256),
      })
      .strict(),
  })
  .strict();

export const externalAgentConnectionVerificationResultSchema = z
  .object({ status: z.literal("connected") })
  .strict();

export const externalAgentConnectionVerificationInputSchema = z
  .object({
    selectedApps: z
      .array(z.string().trim().min(1).max(128))
      .max(100)
      .optional(),
  })
  .strict();

export const chiefChannelContinuationSchema = z
  .object({
    capability: z.string().trim().min(43).max(256),
  })
  .strict();

export const externalAgentDeliveryPayloadSchema = z
  .object({
    deliveryId: z.string().trim().min(8).max(256),
    deliveryGeneration: z.number().int().positive().default(1),
    // Assigned by Chief's durable outbox. Internal enqueue commands omit it;
    // every request delivered to Eve contains it.
    sessionAddress: z.string().trim().min(32).max(256).optional(),
    agentId: agentIdSchema.optional(),
    continuation: chiefChannelContinuationSchema,
    conversationId: conversationIdSchema.optional(),
    threadRootId: messageIdSchema.optional(),
    message: z
      .object({
        id: messageIdSchema,
        body: z.string().max(100_000),
        author: z
          .object({
            kind: z.enum(["user", "agent"]),
            id: z.string().trim().min(1).max(256),
          })
          .strict(),
        createdAt: z.iso.datetime({ offset: true }),
      })
      .strict(),
  })
  .strict();

export const externalAgentDeliveryCommandSchema = commandEnvelopeSchema(
  externalAgentDeliveryPayloadSchema,
);

export const externalAgentDeliveryAcceptedSchema = z
  .object({
    status: z.literal("accepted"),
    sessionId: z.string().trim().min(1).max(256),
  })
  .strict();

export const externalAgentDeliveryReconcilingSchema = z
  .object({ status: z.literal("reconciling") })
  .strict();

export const externalAgentDeliveryResultSchema = z.discriminatedUnion(
  "status",
  [externalAgentDeliveryAcceptedSchema, externalAgentDeliveryReconcilingSchema],
);

export const externalAgentDeliveryRecoverySchema = z
  .object({ decision: z.enum(["inspect", "resend", "drop"]) })
  .strict();

export const externalAgentReconciliationSchema = z
  .object({
    deliveryId: z.string().trim().min(8).max(256),
    deliveryGeneration: z.number().int().positive(),
    lastError: z.string().nullable(),
    createdAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export const externalAgentReconciliationListSchema = z
  .object({ deliveries: z.array(externalAgentReconciliationSchema) })
  .strict();

export const externalAgentRecoveryResultSchema = z.discriminatedUnion(
  "status",
  [
    externalAgentDeliveryAcceptedSchema,
    externalAgentDeliveryReconcilingSchema,
    z.object({ status: z.literal("dropped") }).strict(),
    z
      .object({
        status: z.literal("resend_queued"),
        deliveryGeneration: z.number().int().positive(),
      })
      .strict(),
  ],
);

export const externalAgentInboundMessageSchema = z
  .object({
    deliveryId: z.string().trim().min(8).max(256),
    continuation: chiefChannelContinuationSchema,
    sessionId: z.string().trim().min(1).max(256),
    body: z.string().trim().min(1).max(100_000),
  })
  .strict();

export const externalAgentInboundResultSchema = z
  .object({
    duplicate: z.boolean(),
    messageId: messageIdSchema,
  })
  .strict();

export const externalAgentInboundActivitySchema = z
  .object({
    deliveryId: z.string().trim().min(8).max(256),
    continuation: chiefChannelContinuationSchema,
    sessionId: z.string().trim().min(1).max(256),
    component: agentActivityComponentSchema,
  })
  .strict();

export const externalAgentInboundActivityResultSchema = z
  .object({ messageId: messageIdSchema })
  .strict();

export const externalAgentToolCallSchema = z
  .object({
    deliveryId: z.string().trim().min(8).max(256),
    continuation: chiefChannelContinuationSchema,
    sessionId: z.string().trim().min(1).max(256),
    operationId: z.string().trim().min(1).max(128),
    input: jsonObjectSchema,
  })
  .strict();

export const externalAgentToolResultSchema = z
  .object({
    operationId: z.string().trim().min(1).max(128),
    result: jsonObjectSchema,
  })
  .strict();

export type ExternalAgentRegistrationPayload = z.input<
  typeof externalAgentRegistrationPayloadSchema
>;
export type ChiefChannelContinuation = z.infer<
  typeof chiefChannelContinuationSchema
>;
export type ExternalAgentDeliveryCommand = z.infer<
  typeof externalAgentDeliveryCommandSchema
>;
export type ExternalAgentInboundMessage = z.infer<
  typeof externalAgentInboundMessageSchema
>;
export type ExternalAgentInboundActivity = z.infer<
  typeof externalAgentInboundActivitySchema
>;
export type ExternalAgentToolCall = z.infer<typeof externalAgentToolCallSchema>;
