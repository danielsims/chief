import { z } from "zod";

import { commandEnvelopeSchema, eventEnvelopeSchema } from "./envelopes";
import {
  agentIdSchema,
  conversationIdSchema,
  hexPubkeySchema,
  isoDateTimeSchema,
  jobIdSchema,
  workspaceIdSchema,
} from "./identifiers";

export const agentConfigSchema = z
  .object({
    enabled: z.boolean(),
    driver: z.string().trim().min(1).max(64),
    model: z.string().trim().min(1).max(128),
    approvals: z.enum(["auto", "ask"]),
    capabilities: z.array(z.string().trim().min(1).max(64)).max(64),
    integrations: z.array(z.string().trim().min(1).max(128)).max(128),
    toolPermissions: z.array(z.string().trim().min(1).max(64)).max(32),
  })
  .strict();

export const defaultAgentConfig = agentConfigSchema.parse({
  enabled: true,
  driver: "openCodeGo",
  model: "deepseek-v4-flash-free",
  approvals: "auto",
  capabilities: [],
  integrations: [],
  toolPermissions: ["workspace", "channels", "messages", "scheduled-work"],
});

export type AgentConfig = z.infer<typeof agentConfigSchema>;

export const agentJobSchema = z.object({
  id: jobIdSchema,
  workspaceId: workspaceIdSchema,
  agentId: agentIdSchema,
  agentPubkey: hexPubkeySchema.optional(),
  kind: z.string().trim().min(1).max(128),
  payload: z.record(z.string(), z.unknown()),
  status: z.enum(["pending", "leased", "completed", "failed"]),
  attempt: z.int().nonnegative(),
  availableAt: isoDateTimeSchema,
  leaseExpiresAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

export const enqueueAgentJobPayloadSchema = agentJobSchema
  .pick({
    id: true,
    agentId: true,
    kind: true,
    payload: true,
    availableAt: true,
  })
  .strict();

export const enqueueAgentJobCommandSchema = commandEnvelopeSchema(
  enqueueAgentJobPayloadSchema,
);

export const agentJobEnqueuedEventSchema = eventEnvelopeSchema(
  z.object({ job: agentJobSchema }),
);

export const agentLeaseSchema = z.object({
  job: agentJobSchema,
  leaseToken: z.string().min(32).max(512),
});

export const claimAgentJobSchema = z
  .object({
    workerId: z.string().trim().min(1).max(128),
    leaseSeconds: z.int().min(5).max(300).default(60),
  })
  .strict();

export const agentPublishedMessageSchema = z
  .object({
    conversationId: conversationIdSchema,
    body: z.string().trim().min(1).max(4_000),
    components: z
      .array(
        z.object({
          id: z.string().trim().min(1).max(128),
          kind: z.string().trim().min(1).max(64),
          version: z.int().positive(),
          payload: z.record(z.string(), z.unknown()),
        }),
      )
      .max(32)
      .default([]),
  })
  .strict();

export const agentJobCompletionResultSchema = z
  .object({
    // Every completed agent turn may publish a message to a workspace
    // conversation. `workspace.onboarding` also carries `openingMessage`
    // (appended to mission-control) so a compact executor can keep working.
    publishedMessage: agentPublishedMessageSchema.optional(),
    openingMessage: z.string().trim().min(1).max(4_000).optional(),
  })
  .strict();

export const completeAgentJobSchema = z
  .object({
    leaseToken: z.string().min(32).max(512),
    outcome: z.discriminatedUnion("status", [
      z.object({
        status: z.literal("completed"),
        result: agentJobCompletionResultSchema.default({}),
      }),
      z.object({
        status: z.literal("failed"),
        error: z.string().trim().min(1).max(4_000),
        retryAt: isoDateTimeSchema.optional(),
      }),
    ]),
  })
  .strict();

// Backwards-compatible alias used by the workspace onboarding flow.
export const workspaceOnboardingResultSchema = z
  .object({
    openingMessage: z.string().trim().min(1).max(4_000),
    publishedMessage: agentPublishedMessageSchema.optional(),
  })
  .strict();

export type AgentPublishedMessage = z.infer<typeof agentPublishedMessageSchema>;

export type AgentJob = z.infer<typeof agentJobSchema>;
export type AgentLease = z.infer<typeof agentLeaseSchema>;
