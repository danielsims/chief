import { randomUUID } from "node:crypto";
import { z } from "zod";

import type { TrendRecord } from "../../../types.js";
import { boundedText, optionalBoundedText, time } from "../../input.js";
import { jsonResponse } from "../../response.js";
import { defineLocalTool } from "../../tool.js";

const trendInputSchema = z.object({
  id: optionalBoundedText(120),
  title: boundedText(200),
  source: boundedText(120),
  sourceUrl: optionalBoundedText(500).refine(
    (url) => url === undefined || /^https?:\/\//iu.test(url),
    "sourceUrl must be a direct HTTP or HTTPS URL.",
  ),
  summary: boundedText(2_000),
  signal: z.enum(["high", "medium", "low"]).default("medium"),
  status: z.enum(["new", "watching", "acted", "dismissed"]).default("new"),
  foundAt: z.union([z.number(), z.string()]).optional(),
});

export const saveTrendTool = defineLocalTool({
  method: "POST",
  path: "/local-tools/trends",
  operation: {
    operationId: "trends.save",
    summary: "Save a researched trend",
  },
  inputSchema: trendInputSchema,
  async execute({ input, manager, workspaceId }) {
    const trend: TrendRecord = {
      id: input.id ?? randomUUID(),
      title: input.title,
      source: input.source,
      sourceUrl: input.sourceUrl,
      summary: input.summary,
      signal: input.signal,
      status: input.status,
      foundAt: time(input.foundAt),
    };
    await manager.saveTrend(workspaceId, trend);
    return jsonResponse({ trend });
  },
});
