import { z } from "zod";

import { commandEnvelopeSchema, eventEnvelopeSchema } from "./envelopes";
import {
  agentIdSchema,
  conversationIdSchema,
  hexPubkeySchema,
  isoDateTimeSchema,
  jobIdSchema,
  messageIdSchema,
  secretNameSchema,
  workspaceIdSchema,
} from "./identifiers";
import { jsonObjectSchema, jsonValueSchema } from "./json";

export const agentConfigSchema = z
  .object({
    enabled: z.boolean(),
    deploymentTarget: z.enum(["phone", "desktop", "cloud"]).default("cloud"),
    inference: z
      .object({
        provider: z.literal("opencode"),
        model: z.literal("opencode-go/deepseek-v4-flash"),
        /** Workspace-scoped secret name holding the provider API key. */
        secretRef: secretNameSchema.optional(),
      })
      .strict(),
    approvals: z.enum(["auto", "ask"]),
    capabilities: z.array(z.string().trim().min(1).max(64)).max(64),
    integrations: z.array(z.string().trim().min(1).max(128)).max(128),
    toolPermissions: z
      .array(
        z.enum([
          "workspace.read",
          "workspace.write",
          "projects.read",
          "projects.write",
          "channels.read",
          "channels.create",
          "channels.update",
          "channels.archive",
          "members.read",
          "members.manage",
          "messages.read",
          "messages.send",
          "messages.manage",
          "schedules.read",
          "schedules.manage",
          "schedules.run",
          "webhooks.manage",
          "browser.use",
          "integrations.manage",
          "agents.delegate",
          // Read compatibility for relay workspaces created before the exact
          // Executor permission vocabulary. Clients never write these now.
          "workspace",
          "channels",
          "messages",
          "scheduled-work",
          "advanced",
          "brand-profile-write",
          "prospects-write",
        ]),
      )
      .max(32),
  })
  .strict();

export const defaultAgentConfig = agentConfigSchema.parse({
  enabled: true,
  deploymentTarget: "cloud",
  inference: {
    provider: "opencode",
    model: "opencode-go/deepseek-v4-flash",
  },
  approvals: "auto",
  capabilities: [],
  integrations: [],
  toolPermissions: [
    "workspace.read",
    "channels.read",
    "channels.create",
    "members.read",
    "members.manage",
    "messages.read",
    "messages.send",
  ],
});

export type AgentConfig = z.infer<typeof agentConfigSchema>;

export const agentRuntimeDescriptorSchema = z
  .object({
    workspaceId: workspaceIdSchema,
    agentId: agentIdSchema,
    address: z.url(),
    deploymentTarget: z.enum(["phone", "desktop", "cloud"]),
    status: z.enum(["ready", "waiting", "disabled"]),
    computer: z.enum(["cloudflare-worker", "local-celld"]),
  })
  .strict();

export type AgentRuntimeDescriptor = z.infer<
  typeof agentRuntimeDescriptorSchema
>;

export const invokeAgentSchema = z
  .object({
    instruction: z.string().trim().min(1).max(20_000),
    conversationId: conversationIdSchema.optional(),
    threadRootId: messageIdSchema.optional(),
    idempotencyKey: z.string().trim().min(8).max(256),
  })
  .strict();

export const agentConfigResultSchema = z
  .object({
    agentId: agentIdSchema,
    config: agentConfigSchema,
    updatedAt: isoDateTimeSchema.nullable(),
  })
  .strict();

export type AgentConfigResult = z.infer<typeof agentConfigResultSchema>;

export const agentJobSchema = z.object({
  id: jobIdSchema,
  workspaceId: workspaceIdSchema,
  agentId: agentIdSchema,
  agentPubkey: hexPubkeySchema.optional(),
  kind: z.string().trim().min(1).max(128),
  payload: jsonObjectSchema,
  status: z.enum(["pending", "leased", "completed", "failed"]),
  attempt: z.int().nonnegative(),
  // Kept on the durable job so an authorized workspace owner can understand
  // and resume a failed agent run after every client has disconnected. The
  // default keeps jobs written by older relay versions readable.
  lastError: z.string().trim().min(1).max(4_000).nullable().default(null),
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

export const agentJobListSchema = z
  .object({
    jobs: z.array(agentJobSchema).max(200),
  })
  .strict();

/** Logical celld state, deliberately independent of either celld's SQLite
 * file format or Durable Object SQLite so a cell can move between runtimes. */
export const agentCellSnapshotSchema = z
  .object({
    version: z.literal(2),
    cellId: z.string().trim().min(3).max(260),
    workspaceId: workspaceIdSchema,
    agentId: agentIdSchema,
    exportedAt: isoDateTimeSchema,
    records: z
      .array(
        z
          .object({
            key: z.string().trim().min(1).max(320),
            value: jsonValueSchema,
          })
          .strict(),
      )
      .max(1_000),
    files: z
      .array(
        z
          .object({
            path: z.string().startsWith("/workspace/").max(1_024),
            contentBase64: z.string().max(12_000_000),
          })
          .strict(),
      )
      .max(1_000),
  })
  .strict();

export const retryAgentJobResultSchema = z
  .object({
    job: agentJobSchema,
  })
  .strict();

export const claimAgentJobSchema = z
  .object({
    workerId: z.string().trim().min(1).max(128),
    leaseSeconds: z.int().min(5).max(300).default(60),
  })
  .strict();

export const renewAgentJobSchema = z
  .object({
    leaseToken: z.string().min(32).max(512),
    leaseSeconds: z.int().min(5).max(300).default(60),
  })
  .strict();

export const renewAgentJobResultSchema = z
  .object({ leaseExpiresAt: isoDateTimeSchema })
  .strict();

export const agentPublishedMessageSchema = z
  .object({
    conversationId: conversationIdSchema,
    threadRootId: messageIdSchema.optional(),
    body: z.string().trim().min(1).max(4_000),
    components: z
      .array(
        z.object({
          id: z.string().trim().min(1).max(128),
          kind: z.string().trim().min(1).max(64),
          version: z.int().positive(),
          payload: jsonObjectSchema,
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

export const completeAgentJobResultSchema = z
  .object({
    job: agentJobSchema,
    outcome: completeAgentJobSchema.shape.outcome,
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
export type AgentJobCompletionResult = z.infer<
  typeof agentJobCompletionResultSchema
>;
export type AgentCellSnapshot = z.infer<typeof agentCellSnapshotSchema>;

export type AgentJob = z.infer<typeof agentJobSchema>;
export type AgentLease = z.infer<typeof agentLeaseSchema>;
