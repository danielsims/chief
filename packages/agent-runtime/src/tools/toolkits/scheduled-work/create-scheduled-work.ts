import { z } from "zod";

import { boundedText, optionalBoundedText } from "../../input.js";
import { defineLocalTool } from "../../tool.js";
import { executeScheduledWorkTool } from "./execute.js";
import { scheduledWorkTriggerSchema } from "./input.js";

const createScheduledWorkInputSchema = z.object({
  operationKey: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{4,99}$/u)
    .max(100),
  conversationId: optionalBoundedText(160),
  agentId: boundedText(120),
  title: boundedText(200),
  instructions: boundedText(8_000),
  trigger: scheduledWorkTriggerSchema,
  approvalSummary: boundedText(2_000),
  proposedToolPatterns: z.array(boundedText(240)).max(100),
  activate: z.boolean().default(false),
});

export const createScheduledWorkTool = defineLocalTool({
  method: "POST",
  path: "/local-tools/scheduled-work",
  operation: {
    operationId: "scheduledWork.create",
    summary: "Propose or create scheduled work",
  },
  inputSchema: createScheduledWorkInputSchema,
  execute: (request) => executeScheduledWorkTool(request, request.input),
});
