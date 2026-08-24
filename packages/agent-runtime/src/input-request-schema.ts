import { z } from "zod";

import type { InputRequest } from "./types.js";

const inputFieldSchema = z.object({
  key: z.string(),
  label: z.string(),
  type: z.enum(["text", "secret", "multiline"]).optional(),
  save: z.union([
    z.object({ file: z.string() }),
    z.object({ envKey: z.string() }),
    z.object({ contextKey: z.string() }),
  ]),
});

const agentQuestionSchema = z.object({
  question: z.string(),
  header: z.string().optional(),
  multiSelect: z.boolean().optional(),
  allowFreeform: z.boolean().optional(),
  dismissible: z.boolean().optional(),
  options: z.array(
    z.object({
      label: z.string(),
      description: z.string().optional(),
      allowsFreeText: z.boolean().optional(),
    }),
  ),
});

export const inputRequestSchema: z.ZodType<InputRequest> = z.object({
  id: z.string(),
  title: z.string(),
  reason: z.string().optional(),
  steps: z
    .array(z.object({ text: z.string(), url: z.string().optional() }))
    .optional(),
  questions: z.array(agentQuestionSchema).optional(),
  fields: z.array(inputFieldSchema),
  contextAuthorization: z.string().optional(),
});
