import { randomUUID } from "node:crypto";
import { z } from "zod";

import type { CampaignRecord } from "../../../../types.js";
import { boundedText, optionalBoundedText } from "../../input.js";
import { jsonResponse } from "../../response.js";
import { defineLocalTool } from "../../tool.js";

function optionalAmount(name: string) {
  return z
    .union([z.number(), z.string()])
    .optional()
    .transform((input, context) => {
      if (input === undefined || input === "") return undefined;
      const amount = Number(input);
      if (!Number.isFinite(amount) || amount < 0) {
        context.addIssue({
          code: "custom",
          message: `${name} must be a positive number.`,
        });
        return z.NEVER;
      }
      return amount;
    });
}

const campaignInputSchema = z.object({
  id: optionalBoundedText(120),
  name: boundedText(200),
  provider: boundedText(120),
  objective: optionalBoundedText(500),
  status: z
    .enum(["draft", "in_review", "live", "paused", "completed"])
    .default("draft"),
  currency: optionalBoundedText(8).transform((input) => input ?? "USD"),
  budget: optionalAmount("budget"),
  spend: optionalAmount("spend"),
  revenue: optionalAmount("revenue"),
});

export const saveCampaignTool = defineLocalTool({
  method: "POST",
  path: "/local-tools/campaigns",
  operation: {
    operationId: "campaigns.save",
    summary: "Create or update a paid campaign plan",
  },
  inputSchema: campaignInputSchema,
  async execute({ input, manager, workspaceId }) {
    const now = Date.now();
    const campaign: CampaignRecord = {
      id: input.id ?? randomUUID(),
      name: input.name,
      provider: input.provider,
      objective: input.objective,
      status: input.status,
      currency: input.currency,
      budget: input.budget,
      spend: input.spend,
      revenue: input.revenue,
      createdAt: now,
      updatedAt: now,
    };
    await manager.saveCampaign(workspaceId, campaign);
    return jsonResponse({ campaign });
  },
});
