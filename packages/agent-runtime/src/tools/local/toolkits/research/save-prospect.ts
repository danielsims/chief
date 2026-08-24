import { randomUUID } from "node:crypto";
import { z } from "zod";

import type { ProspectRecord } from "../../../../types.js";
import { boundedText, optionalBoundedText, time } from "../../input.js";
import { jsonResponse } from "../../response.js";
import { defineLocalTool } from "../../tool.js";

const prospectInputSchema = z.object({
  id: optionalBoundedText(120),
  name: boundedText(160),
  company: optionalBoundedText(160),
  source: boundedText(120),
  sourceUrl: boundedText(500).refine(
    (url) => /^https?:\/\//iu.test(url),
    "sourceUrl must be a direct HTTP or HTTPS URL.",
  ),
  summary: boundedText(2_000),
  relevance: z.enum(["high", "medium", "low"]).default("medium"),
  status: z
    .enum(["new", "researching", "contacted", "dismissed"])
    .default("new"),
  foundAt: z.union([z.number(), z.string()]).optional(),
});

export const saveProspectTool = defineLocalTool({
  method: "POST",
  path: "/local-tools/prospects",
  operation: {
    operationId: "prospects.save",
    summary: "Save a researched prospect",
    description:
      "Stores evidence-backed research. sourceUrl must link directly to the supporting public source.",
  },
  inputSchema: prospectInputSchema,
  async execute({ input, manager, workspaceId }) {
    const prospect: ProspectRecord = {
      id: input.id ?? randomUUID(),
      name: input.name,
      company: input.company,
      source: input.source,
      sourceUrl: input.sourceUrl,
      summary: input.summary,
      relevance: input.relevance,
      status: input.status,
      foundAt: time(input.foundAt),
    };
    await manager.saveProspect(workspaceId, prospect);
    return jsonResponse({ prospect });
  },
});
