import { z } from "zod";

import { commandIdSchema, workspaceIdSchema } from "./identifiers";

export const onboardingStageSchema = z.enum([
  "workspace-home",
  "workspace-profile",
  "agent-hosting",
  "inference-provider",
  "apps",
  "workspace-create",
]);
export type OnboardingStage = z.infer<typeof onboardingStageSchema>;

export const onboardingEventNameSchema = z.enum([
  "viewed",
  "advanced",
  "failed",
  "completed",
]);

export const onboardingTelemetryEventSchema = z
  .object({
    sessionId: commandIdSchema,
    stage: onboardingStageSchema,
    event: onboardingEventNameSchema,
    hosting: z.enum(["chief-cloud", "self-hosted"]).optional(),
    provider: z.string().trim().min(1).max(64).optional(),
    selectedAppCount: z.int().min(0).max(100).optional(),
    workspaceId: workspaceIdSchema.optional(),
    errorCode: z.string().trim().min(1).max(96).optional(),
  })
  .strict();

export type OnboardingTelemetryEvent = z.infer<
  typeof onboardingTelemetryEventSchema
>;

export const onboardingTelemetryReceiptSchema = z
  .object({ accepted: z.literal(true) })
  .strict();
