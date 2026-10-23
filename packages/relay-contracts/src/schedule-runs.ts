import { z } from "zod";

import { automationRunStateSchema } from "./automations";
import { agentIdSchema } from "./identifiers";
import { jsonObjectSchema } from "./json";
import { workspaceScheduleSchema } from "./schedules";

/**
 * A step's assignment and result carry real work (a research step's findings,
 * earlier steps' output) from one agent to the next, so they're sized for that:
 * with the brief and trigger data they still fit in one message body.
 */
export const scheduleRunStepTextLimit = 60_000;

export const scheduleRunStepSchema = z.object({
  id: z.uuid(),
  commandId: z.uuid(),
  agentId: agentIdSchema,
  phase: z.enum(["plan", "contribute", "finish", "automation"]),
  state: z.enum(["pending", "running", "completed", "failed"]),
  jobId: z.string().optional(),
  assignment: z.string().trim().min(1).max(scheduleRunStepTextLimit).optional(),
  evidence: z.string().max(scheduleRunStepTextLimit).optional(),
  error: z.string().optional(),
  startedAt: z.number().optional(),
  completedAt: z.number().optional(),
});
export const scheduleRunSchema = z.object({
  id: z.string().min(1).max(256),
  scheduleId: z.string(),
  source: z.enum(["cron", "manual", "webhook", "retry"]),
  sourceId: z.string().optional(),
  retryOf: z.string().optional(),
  /**
   * A test before turning an automation on: reads and agents run for real,
   * write tools are only previewed, and it may run before approval.
   */
  test: z.boolean().optional(),
  input: jsonObjectSchema.default({}),
  schedule: workspaceScheduleSchema,
  threadRootId: z.uuid(),
  state: z.enum([
    "queued",
    "running",
    "blocked",
    "completed",
    "failed",
    "cancelled",
  ]),
  steps: z.array(scheduleRunStepSchema).max(30),
  automation: automationRunStateSchema.optional(),
  scheduledAt: z.number(),
  startedAt: z.number().optional(),
  completedAt: z.number().optional(),
  nextCheckAt: z.number().optional(),
  summary: z.string().max(scheduleRunStepTextLimit).default(""),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export const scheduleRunListSchema = z.object({
  runs: z.array(scheduleRunSchema).max(100),
});
export const scheduleRunActionSchema = z.object({
  action: z.enum(["cancel", "retry"]),
  commandId: z.uuid(),
});
export const scheduleRunReportSchema = z.object({
  runId: z.string().min(1).max(256),
  stepId: z.uuid(),
  status: z.enum(["completed", "blocked"]),
  evidence: z.string().trim().min(1).max(scheduleRunStepTextLimit),
});
export type ScheduleRun = z.infer<typeof scheduleRunSchema>;
export type ScheduleRunStep = z.infer<typeof scheduleRunStepSchema>;

/**
 * An automation's inbound address. The token in its URL is the only
 * credential unless a signing secret is set, in which case every delivery
 * must also carry a valid Standard Webhooks signature.
 */
export const automationWebhookSchema = z.object({
  scheduleId: z.string().min(1).max(120),
  url: z.url(),
  /** Whether a signing secret is set. The secret itself is never returned. */
  signed: z.boolean(),
  createdAt: z.number(),
  lastDeliveryAt: z.number().optional(),
  lastRunId: z.string().optional(),
});

/** A Standard Webhooks secret, as senders such as Granola show it. */
export const webhookSigningSecretSchema = z
  .string()
  .trim()
  .max(200)
  .regex(
    /^whsec_[A-Za-z0-9+/]+={0,2}$/u,
    "Paste the whole secret, starting with whsec_.",
  );

export const automationWebhookRequestSchema = z
  .discriminatedUnion("action", [
    z.object({ action: z.literal("get") }),
    /** Replace the URL, so the old one stops working. */
    z.object({ action: z.literal("reset") }),
    z.object({
      action: z.literal("set-signing-secret"),
      secret: webhookSigningSecretSchema,
    }),
    z.object({ action: z.literal("remove-signing-secret") }),
  ])
  .default({ action: "get" });
export type AutomationWebhookRequest = z.input<
  typeof automationWebhookRequestSchema
>;
/** A recent delivery, kept so steps can be mapped to real fields and tested. */
export const automationWebhookEventSchema = z.object({
  receivedAt: z.number(),
  input: jsonObjectSchema,
});
export const automationWebhookEventListSchema = z.object({
  events: z.array(automationWebhookEventSchema).max(3),
});
export type AutomationWebhookEvent = z.infer<
  typeof automationWebhookEventSchema
>;

export const automationWebhookListSchema = z.object({
  webhooks: z.array(automationWebhookSchema).max(250),
});
export const automationWebhookRevokedSchema = z.object({
  revoked: z.literal(true),
});
export type AutomationWebhook = z.infer<typeof automationWebhookSchema>;

export const scheduleRunCollaboratorSchema = z.object({
  runId: z.string().min(1).max(256),
  agentId: agentIdSchema,
  assignment: z.string().trim().min(1).max(scheduleRunStepTextLimit),
});
