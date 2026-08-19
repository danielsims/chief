import { z } from "zod";

import {
  commandIdSchema,
  eventIdSchema,
  isoDateTimeSchema,
  workspaceIdSchema,
} from "./identifiers";
import { principalSchema } from "./identity";

export const protocolVersionSchema = z.literal(1);

export function commandEnvelopeSchema<T extends z.ZodType>(payload: T) {
  return z
    .object({
      commandId: commandIdSchema,
      protocolVersion: protocolVersionSchema,
      occurredAt: isoDateTimeSchema,
      payload,
    })
    .strict();
}

export function eventEnvelopeSchema<T extends z.ZodType>(payload: T) {
  return z.object({
    eventId: eventIdSchema,
    sequence: z.int().nonnegative(),
    protocolVersion: protocolVersionSchema,
    workspaceId: workspaceIdSchema,
    streamId: z.string().trim().min(1).max(256),
    type: z.string().trim().min(1).max(128),
    actor: principalSchema,
    correlationId: z.string().trim().min(1).max(128).optional(),
    causationId: z.string().trim().min(1).max(128).optional(),
    occurredAt: isoDateTimeSchema,
    payload,
  });
}

export const relayErrorSchema = z.object({
  error: z.object({
    code: z.string().trim().min(1).max(64),
    message: z.string().trim().min(1).max(512),
    requestId: z.string().trim().min(1).max(128).optional(),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
});

export type RelayError = z.infer<typeof relayErrorSchema>;
