import { z } from "zod";

import type { ActionItem, ProspectRecord } from "./types.js";
import { inputRequestSchema } from "./input-request-schema.js";

const prospectSchema: z.ZodType<ProspectRecord> = z.object({
  id: z.string(),
  name: z.string(),
  company: z.string().optional(),
  source: z.string(),
  sourceUrl: z.string().optional(),
  summary: z.string(),
  evidence: z.string().optional(),
  outreachAngle: z.string().optional(),
  relevance: z.enum(["high", "medium", "low"]),
  status: z.enum(["new", "researching", "contacted", "dismissed"]),
  foundAt: z.number(),
});

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
      answers: z.record(z.string()),
      resolvedAt: z.number(),
      resolvedBy: z.object({ id: z.string(), name: z.string() }),
    })
    .optional(),
  status: z.enum(["open", "resolved", "dismissed"]),
  createdAt: z.number(),
});

export const cloudRecordsSchema = z.object({
  prospects: z.array(prospectSchema).optional(),
  files: z.array(workspaceFileSchema).optional(),
  actions: z.array(actionItemSchema).optional(),
});
