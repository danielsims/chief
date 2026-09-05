import { z } from "zod";

import { agentIdSchema, conversationIdSchema } from "./identifiers";

export const workspaceScheduleInputSchema = z.object({
  id: z.string().trim().min(1).max(120),
  conversationId: conversationIdSchema,
  agentId: agentIdSchema,
  collaborators: z.array(agentIdSchema).max(12).default([]),
  expectedOutcome: z.string().trim().max(2_000).default(""),
  constraints: z.string().trim().max(4_000).default(""),
  maxDurationMinutes: z.int().min(5).max(1_440).default(60),
  triggerMode: z.enum(["cron", "webhook"]).default("cron"),
  missionId: z.string().trim().min(1).max(120).optional(),
  title: z.string().trim().min(1).max(200),
  instructions: z.string().trim().min(1).max(8_000),
  cron: z.string().trim().max(120).default("0 9 * * *"),
  timezone: z.string().trim().min(1).max(120),
  onceAt: z
    .union([z.number(), z.string().transform((value) => Date.parse(value))])
    .pipe(z.number().int().positive())
    .optional(),
  approvalSummary: z.string().max(2_000).default(""),
  proposedToolPatterns: z.array(z.string().max(300)).max(30).default([]),
  skipDates: z
    .array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/u))
    .max(366)
    .default([]),
});

export const workspaceScheduleSchema = workspaceScheduleInputSchema.extend({
  status: z.enum(["draft", "needs_approval", "active", "paused", "error"]),
  placement: z.literal("cloud"),
  nextAt: z.number().optional(),
  lastMessageId: z.string().optional(),
  lastDispatchedAt: z.number().optional(),
  lastCompletedAt: z.number().optional(),
  lastSummary: z.string().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
  upcomingRuns: z.array(z.number()).default([]),
});

export const workspaceScheduleActionSchema = z.object({
  action: z.enum(["approve", "pause", "resume", "run"]),
  commandId: z.uuid(),
  expectedUpdatedAt: z.number().optional(),
});
export const workspaceSchedulesResultSchema = z.object({
  schedules: z.array(workspaceScheduleSchema),
});
export const workspaceScheduleDeleteResultSchema = z.object({
  deleted: z.boolean(),
});
export type WorkspaceSchedule = z.infer<typeof workspaceScheduleSchema>;
export type WorkspaceScheduleInput = z.infer<
  typeof workspaceScheduleInputSchema
>;
export type WorkspaceScheduleAction = z.infer<
  typeof workspaceScheduleActionSchema
>["action"];
