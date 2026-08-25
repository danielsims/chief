import { z } from "zod";

import { defineAgentTool } from "../../definition.js";
import { boundedText, optionalBoundedText } from "../../input.js";

export const prospectInputSchema = z.object({
  id: optionalBoundedText(120),
  name: boundedText(160),
  company: optionalBoundedText(160),
  source: boundedText(120),
  sourceUrl: boundedText(500).refine(
    (url) => /^https?:\/\//iu.test(url),
    "sourceUrl must be a direct HTTP or HTTPS URL.",
  ),
  summary: boundedText(2_000),
  evidence: boundedText(10_000),
  outreachAngle: boundedText(10_000),
  relevance: z.enum(["high", "medium", "low"]).default("medium"),
  status: z
    .enum(["new", "researching", "contacted", "dismissed"])
    .default("new"),
  foundAt: z.union([z.number(), z.string()]).optional(),
});

export const saveProspectDefinition = defineAgentTool({
  method: "POST",
  path: "/local-tools/prospects",
  operation: {
    operationId: "prospects.save",
    summary: "Save a researched prospect",
    description:
      "Stores evidence-backed research. sourceUrl must link directly to the supporting public source.",
  },
  inputSchema: prospectInputSchema,
});
