import { z } from "zod";

import type { JsonValue } from "@chief/relay-contracts";
import { parseJsonValue } from "@chief/relay-contracts";

import type { RecurringWorkRecord } from "./types.js";
import { inputRequestSchema } from "./input-request-schema.js";

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

function parseMarkerPayload(payload: string): JsonValue | undefined {
  try {
    return parseJsonValue(JSON.parse(payload));
  } catch {
    return undefined;
  }
}

export function requestedInput(summary: string | undefined) {
  const payload = markerPayload(summary, "CHIEF_INPUT_REQUEST ");
  if (!payload) return null;
  const result = inputRequestSchema.safeParse(parseMarkerPayload(payload));
  return result.success ? result.data : null;
}

export function requestedSourceRequirement(
  summary: string | undefined,
  agentId: RecurringWorkRecord["agentId"],
  fallbackReason?: string | null,
): SourceRequirement | null {
  const payload = markerPayload(summary, "CHIEF_SETUP_REQUIRED ");
  if (payload) {
    const result = z
      .object({
        category: sourceCategorySchema.catch("research"),
        providers: z.array(z.string()).catch([]),
        reason: z.string().optional(),
      })
      .safeParse(parseMarkerPayload(payload));
    if (result.success) {
      const parsed = result.data;
      const reason = parsed.reason?.trim() ?? fallbackReason;
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
    }
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
