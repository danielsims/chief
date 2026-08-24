import { z } from "zod";

import type { InputRequest, RecurringWorkRecord } from "./types.js";

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

const inputRequestSchema: z.ZodType<InputRequest> = z.object({
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

const sourceCategorySchema = z.enum(["analytics", "ads", "social", "research"]);

export interface SourceRequirement {
  category: z.infer<typeof sourceCategorySchema> | "other";
  providers: string[];
  reason: string;
}

function markerPayload(summary: string | undefined, marker: string) {
  return summary
    ?.split("\n")
    .find((candidate) => candidate.trim().startsWith(marker))
    ?.trim()
    .slice(marker.length);
}

export function requestedInput(summary: string | undefined) {
  const payload = markerPayload(summary, "CHIEF_INPUT_REQUEST ");
  if (!payload) return null;
  try {
    const result = inputRequestSchema.safeParse(JSON.parse(payload));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

export function requestedSourceRequirement(
  summary: string | undefined,
  agentId: RecurringWorkRecord["agentId"],
  fallbackReason?: string | null,
): SourceRequirement | null {
  const payload = markerPayload(summary, "CHIEF_SETUP_REQUIRED ");
  if (payload) {
    try {
      const parsed = z
        .object({
          category: sourceCategorySchema.catch("research"),
          providers: z.array(z.string()).catch([]),
          reason: z.string().optional(),
        })
        .parse(JSON.parse(payload));
      const reason = parsed.reason?.trim() || fallbackReason;
      if (reason) {
        return {
          category: parsed.category,
          providers: parsed.providers
            .map((provider) => provider.trim())
            .filter(Boolean)
            .slice(0, 8),
          reason,
        };
      }
    } catch {}
  }
  if (!fallbackReason) return null;
  if (agentId === "analyst") {
    return {
      category: "analytics",
      providers: ["google-analytics"],
      reason: fallbackReason,
    };
  }
  if (agentId === "prospector") {
    return {
      category: "research",
      providers: ["reddit.com", "x.com"],
      reason: fallbackReason,
    };
  }
  if (agentId === "content") {
    return {
      category: "social",
      providers: ["x.com", "linkedin.com", "instagram.com"],
      reason: fallbackReason,
    };
  }
  return { category: "other", providers: [], reason: fallbackReason };
}
