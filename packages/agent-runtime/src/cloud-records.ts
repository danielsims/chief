import { z } from "zod";

import type { ActionItem } from "./types.js";
import { inputRequestSchema } from "./input-request-schema.js";

const workspaceFileSchema = z.object({
  id: z.string(),
  name: z.string(),
  path: z.string(),
  mimeType: z.string(),
  kind: z.enum(["document", "email"]),
  content: z.string(),
  createdBy: z.enum(["agent", "user"]),
  sourceAgentId: z.string().optional(),
  sourceSessionId: z.string().optional(),
});

const actionItemSchema: z.ZodType<ActionItem> = z.object({
  id: z.string(),
  agentId: z.string(),
  title: z.string(),
  reason: z.string(),
  sourceId: z.string().optional(),
  threadRootId: z.string().optional(),
  request: inputRequestSchema.optional(),
  resolution: z
    .object({
      answers: z.record(z.string(), z.string()),
      resolvedAt: z.number(),
      resolvedBy: z.object({ id: z.string(), name: z.string() }),
    })
    .optional(),
  status: z.enum(["open", "resolved", "dismissed"]),
  createdAt: z.number(),
});

export const cloudRecordsSchema = z.object({
  files: z.array(workspaceFileSchema).optional(),
  actions: z.array(actionItemSchema).optional(),
});
