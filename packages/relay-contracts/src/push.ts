import { z } from "zod";

import { isoDateTimeSchema } from "./identifiers";

export const pushEnvironmentSchema = z.enum(["sandbox", "production"]);

export const registerPushDeviceCommandSchema = z
  .object({
    token: z
      .string()
      .trim()
      .regex(/^[0-9a-fA-F]{64,200}$/u, "APNs device tokens are hex."),
    environment: pushEnvironmentSchema,
  })
  .strict();

export const registerPushDeviceResultSchema = z
  .object({
    token: z.string().trim().min(1),
    environment: pushEnvironmentSchema,
    updatedAt: isoDateTimeSchema,
    apnsConfigured: z.boolean(),
  })
  .strict();

export const unregisterPushDeviceCommandSchema = z
  .object({ token: z.string().trim().min(1).max(200) })
  .strict();

export type PushEnvironment = z.infer<typeof pushEnvironmentSchema>;
export type RegisterPushDeviceCommand = z.infer<
  typeof registerPushDeviceCommandSchema
>;
export type RegisterPushDeviceResult = z.infer<
  typeof registerPushDeviceResultSchema
>;
