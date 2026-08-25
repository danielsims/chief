import { z } from "zod";

import { optionalBoundedText } from "../../input.js";
import { defineLocalTool } from "../../tool.js";
import { executeScheduledWorkTool } from "./execute.js";

const runScheduledWorkInputSchema = z.object({
  idempotencyKey: optionalBoundedText(160),
});

export const runScheduledWorkTool = defineLocalTool({
  method: "POST",
  path: "/local-tools/scheduled-work/{scheduledWorkId}/runs",
  operation: {
    operationId: "scheduledWork.run",
    summary: "Queue an approved run",
  },
  inputSchema: runScheduledWorkInputSchema,
  execute: (request) => executeScheduledWorkTool(request, request.input),
});
