import { z } from "zod";

import { defineAgentTool } from "../../definition.js";
import { boundedText, optionalBoundedText } from "../../input.js";

const toolAddressSchema = boundedText(300).refine(
  (address) => /^tools\.[A-Za-z0-9_.-]+$/u.test(address),
  "Tool patterns must be exact Executor tool addresses.",
);

export const recurringWorkInputSchema = z.object({
  id: optionalBoundedText(120),
  conversationId: optionalBoundedText(160),
  newChannel: z
    .object({
      name: optionalBoundedText(80),
      inviteUserIds: z.array(boundedText(160)).max(30).default([]),
    })
    .optional(),
  skipDates: z
    .array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/u))
    .max(366)
    .default([]),
  playbookId: optionalBoundedText(120),
  missionId: optionalBoundedText(120),
  agentId: boundedText(120),
  collaborators: z.array(boundedText(120)).max(12).default([]),
  expectedOutcome: z.string().max(2000).default(""),
  constraints: z.string().max(4000).default(""),
  maxDurationMinutes: z.number().int().min(5).max(1440).default(60),
  triggerMode: z.enum(["cron", "webhook"]).default("cron"),
  title: boundedText(200),
  instructions: boundedText(8_000),
  cron: boundedText(120).default("0 9 * * *"),
  timezone: boundedText(120),
  onceAt: z.union([z.number(), z.string()]).optional(),
  approvalSummary: z.string().max(2_000).default(""),
  proposedToolPatterns: z
    .array(toolAddressSchema)
    .max(30)
    .transform((addresses) => [...new Set(addresses)])
    .default([]),
  activate: z.boolean().default(false),
});

export const proposeRecurringWorkDefinition = defineAgentTool({
  method: "POST",
  path: "/local-tools/recurring-work",
  operation: {
    operationId: "recurringWork.propose",
    summary: "Propose recurring or one-time agent work for user approval",
    description:
      "Configure the complete scheduled team: lead agentId, collaborators, instructions, optional outcome/constraints/run limit, and a cron, onceAt or webhook trigger. Set newChannel to {} to create a mission channel automatically, or provide its name and inviteUserIds. Otherwise use conversationId; missing teammates are added with membership permission. Supply timezone and optionally skipDates. Use a stable id to revise a proposal. The user must approve the latest proposal before execution; webhook triggers are connected through workspace Webhooks settings.",
  },
  inputSchema: recurringWorkInputSchema,
});
export const listRecurringWorkDefinition = defineAgentTool({
  method: "GET",
  path: "/local-tools/recurring-work",
  operation: {
    operationId: "recurringWork.list",
    summary: "List schedules and their approval state",
  },
});
