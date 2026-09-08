import { z } from "zod";

import {
  agentIdSchema,
  conversationIdSchema,
  isoDateTimeSchema,
  workspaceIdSchema,
} from "./identifiers";

export const missionSuccessSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("deliverable"),
      description: z.string().trim().min(1).max(2000),
    })
    .strict(),
  z
    .object({
      kind: z.literal("metric"),
      name: z.string().trim().min(1).max(120),
      unit: z.string().max(40),
      direction: z.enum(["increase", "decrease"]),
      baseline: z.number().finite(),
      target: z.number().finite(),
      source: z.string().trim().min(1).max(2000),
      evaluationWindow: z.string().trim().min(1).max(1000),
    })
    .strict(),
]);
export const missionCreateSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]{4,99}$/u),
    conversationId: conversationIdSchema,
    title: z.string().trim().min(1).max(200),
    objective: z.string().trim().min(1).max(4000),
    ownerAgentId: agentIdSchema,
    collaborators: z.array(agentIdSchema).max(12).default([]),
    projectId: z.string().trim().min(1).max(160).optional(),
    success: missionSuccessSchema,
    maxExperiments: z.int().min(1).max(100),
    deadline: isoDateTimeSchema,
    constraints: z.string().trim().min(1).max(4000),
  })
  .strict();
export const missionExperimentInputSchema = z
  .object({
    id: z.string().trim().min(1).max(120),
    hypothesis: z.string().trim().min(1).max(2000),
    change: z.string().trim().min(1).max(4000),
    value: z.number().finite().nullable(),
    evidence: z.string().trim().min(1).max(4000),
    decision: z.enum(["keep", "discard", "inconclusive"]),
  })
  .strict();
export const missionSchema = missionCreateSchema.extend({
  workspaceId: workspaceIdSchema,
  status: z.enum(["active", "paused", "completed"]),
  statusEvidence: z.string().max(4000).nullable().default(null),
  experiments: z
    .array(
      missionExperimentInputSchema.extend({
        recordedAt: isoDateTimeSchema,
        agentId: agentIdSchema.nullable(),
      }),
    )
    .max(100),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export const missionListSchema = z.object({ missions: z.array(missionSchema) });
export const missionStatusUpdateSchema = z
  .object({
    status: z.enum(["active", "paused", "completed"]),
    evidence: z.string().trim().min(1).max(4000),
  })
  .strict();
export type Mission = z.infer<typeof missionSchema>;
export type MissionCreate = z.infer<typeof missionCreateSchema>;
export type MissionExperimentInput = z.infer<
  typeof missionExperimentInputSchema
>;

export function missionBestValue(mission: Mission) {
  if (mission.success.kind !== "metric") return null;
  const values = [
    mission.success.baseline,
    ...mission.experiments.flatMap((item) =>
      item.decision === "keep" && item.value !== null ? [item.value] : [],
    ),
  ];
  return mission.success.direction === "increase"
    ? Math.max(...values)
    : Math.min(...values);
}
