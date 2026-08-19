import { z } from "zod";

import { workspaceIdSchema } from "./identifiers";

/**
 * A retained, workspace-scoped operational log. One table, one `type` field.
 * Clients strip credentials and user content before sending; the relay stores
 * only redacted facts so the log can be retained, queried, and replayed.
 */
export const logTypeSchema = z.enum([
  "trace",
  "debug",
  "info",
  "warn",
  "error",
]);

const logMetadataValueSchema = z.union([
  z.string().max(256),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);

const sensitiveMetadataKey =
  /(?:authorization|cookie|credential|password|secret|token|api[-_]?key)/iu;

const logMetadataSchema = z
  .record(z.string().min(1).max(64), logMetadataValueSchema)
  .superRefine((metadata, context) => {
    if (Object.keys(metadata).length > 16) {
      context.addIssue({
        code: "custom",
        message: "Log metadata cannot contain more than 16 fields.",
      });
    }
    if (Object.keys(metadata).some((key) => sensitiveMetadataKey.test(key))) {
      context.addIssue({
        code: "custom",
        message: "Log metadata cannot contain credential-like fields.",
      });
    }
  });

export const logRecordSchema = z
  .object({
    id: z.string().min(1).max(64),
    correlationId: z.string().min(1).max(64),
    workspaceId: workspaceIdSchema,
    type: logTypeSchema,
    operation: z.string().min(1).max(96),
    deployment: z.string().max(64).optional(),
    agentId: z.string().max(64).optional(),
    conversationId: z.string().max(64).optional(),
    message: z.string().min(1).max(512),
    metadata: logMetadataSchema.optional(),
    createdAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export type LogRecord = z.infer<typeof logRecordSchema>;

export const logBatchSchema = z
  .object({
    logs: z.array(logRecordSchema).min(1).max(100),
  })
  .strict();

export type LogBatch = z.infer<typeof logBatchSchema>;

export const logPageSchema = z
  .object({
    logs: z.array(logRecordSchema),
    nextCursor: z.string().optional(),
  })
  .strict();

export type LogPage = z.infer<typeof logPageSchema>;

export const logReceiptSchema = z
  .object({ accepted: z.int().min(1).max(100) })
  .strict();

export type LogReceipt = z.infer<typeof logReceiptSchema>;
