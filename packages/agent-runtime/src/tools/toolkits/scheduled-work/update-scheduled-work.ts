import { z } from "zod";

import { boundedText, optionalBoundedText } from "../../input.js";
import { defineLocalTool } from "../../tool.js";
import { executeScheduledWorkTool } from "./execute.js";
import { scheduledWorkTriggerSchema } from "./input.js";

const updateScheduledWorkInputSchema = z.object({
  expectedVersion: z.number().int().min(1).optional(),
  agentId: optionalBoundedText(120),
  title: optionalBoundedText(200),
  instructions: optionalBoundedText(8_000),
  trigger: scheduledWorkTriggerSchema.optional(),
  proposedToolPatterns: z.array(boundedText(240)).max(100).optional(),
});

export const updateScheduledWorkTool = defineLocalTool({
  method: "PATCH",
  path: "/local-tools/scheduled-work/{scheduledWorkId}",
  operation: {
    operationId: "scheduledWork.update",
    summary: "Update scheduled work",
  },
  inputSchema: updateScheduledWorkInputSchema,
  execute: (request) => executeScheduledWorkTool(request, request.input),
});
