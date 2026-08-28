import { z } from "zod";

import {
  agentIdSchema,
  isoDateTimeSchema,
  workspaceIdSchema,
} from "./identifiers";

export const machineKindSchema = z.enum(["cloudflare", "self-hosted"]);
export const machineStatusSchema = z.enum(["pairing", "online", "offline"]);
export const machineCapabilitySchema = z.enum([
  "browser",
  "files",
  "git",
  "screen",
  "shell",
]);

export const machineSchema = z
  .object({
    id: z.string().uuid(),
    workspaceId: workspaceIdSchema,
    name: z.string().trim().min(1).max(120),
    kind: machineKindSchema,
    status: machineStatusSchema,
    endpoint: z.url().max(2_048).optional(),
    capabilities: z.array(machineCapabilitySchema).max(5),
    agentIds: z.array(agentIdSchema).max(100),
    lastSeenAt: isoDateTimeSchema.optional(),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
  })
  .strict();

export const machineCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    kind: machineKindSchema,
    endpoint: z.url().max(2_048).optional(),
    capabilities: z.array(machineCapabilitySchema).max(5),
  })
  .strict();

export const machineUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    capabilities: z.array(machineCapabilitySchema).max(5),
    agentIds: z.array(agentIdSchema).max(100),
  })
  .strict();

export const machinesResultSchema = z
  .object({ machines: z.array(machineSchema) })
  .strict();

export const machineDeleteResultSchema = z
  .object({ id: z.string().uuid(), deleted: z.literal(true) })
  .strict();

export type Machine = z.infer<typeof machineSchema>;
export type MachineCapability = z.infer<typeof machineCapabilitySchema>;
export type MachineCreate = z.infer<typeof machineCreateSchema>;
export type MachineUpdate = z.infer<typeof machineUpdateSchema>;
