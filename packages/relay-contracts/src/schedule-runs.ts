import { z } from "zod";

import { agentIdSchema } from "./identifiers";
import { jsonObjectSchema } from "./json";
import { workspaceScheduleSchema } from "./schedules";

export const scheduleRunStepSchema = z.object({
  id: z.uuid(),
  commandId: z.uuid(),
  agentId: agentIdSchema,
  phase: z.enum(["plan", "contribute", "finish"]),
  state: z.enum(["pending", "running", "completed", "failed"]),
  jobId: z.string().optional(),
  evidence: z.string().max(4000).optional(),
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
  steps: z.array(scheduleRunStepSchema).max(14),
  scheduledAt: z.number(),
  startedAt: z.number().optional(),
  completedAt: z.number().optional(),
  nextCheckAt: z.number().optional(),
  summary: z.string().max(4000).default(""),
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
  evidence: z.string().trim().min(1).max(4000),
});
export type ScheduleRun = z.infer<typeof scheduleRunSchema>;
export type ScheduleRunStep = z.infer<typeof scheduleRunStepSchema>;

export const scheduleWebhookSchema = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1).max(100),
  scheduleId: z.string().min(1).max(120),
  enabled: z.boolean(),
  url: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
  lastDeliveryAt: z.number().optional(),
  lastRunId: z.string().optional(),
});
export const scheduleWebhookListSchema = z.object({
  webhooks: z.array(scheduleWebhookSchema).max(250),
});
export const scheduleWebhookCreateSchema = scheduleWebhookSchema.pick({
  name: true,
  scheduleId: true,
});
export const scheduleWebhookActionSchema = z.object({
  action: z.enum(["enable", "disable", "rotate", "delete"]),
});
export const scheduleWebhookSecretSchema = z.object({
  webhook: scheduleWebhookSchema,
  secret: z.string().optional(),
});
export type ScheduleWebhook = z.infer<typeof scheduleWebhookSchema>;
