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
  playbookId: optionalBoundedText(120),
  missionId: optionalBoundedText(120),
  agentId: boundedText(120),
  title: boundedText(200),
  instructions: boundedText(8_000),
  cron: boundedText(120),
  timezone: boundedText(120),
  onceAt: z.union([z.number(), z.string()]).optional(),
  approvalSummary: boundedText(2_000),
  proposedToolPatterns: z
    .array(toolAddressSchema)
    .max(30)
    .transform((addresses) => [...new Set(addresses)]),
  activate: z.boolean().default(false),
});

export const proposeRecurringWorkDefinition = defineAgentTool({
  method: "POST",
  path: "/local-tools/recurring-work",
  operation: {
    operationId: "recurringWork.propose",
    summary: "Propose recurring or one-time agent work for user approval",
    description:
      "Create a schedule for an agent in a channel. Use a stable id when revising a proposal. The user must approve it in Schedule before it runs. Supply cron and timezone; set onceAt for one-time work. Add missionId when this belongs to a mission.",
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
