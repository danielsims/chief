import { defineLocalTool } from "../../tool.js";
import { executeScheduledWorkTool } from "./execute.js";

export const retryScheduledWorkRunTool = defineLocalTool({
  method: "POST",
  path: "/local-tools/scheduled-work/{scheduledWorkId}/runs/{runId}/retry",
  operation: {
    operationId: "scheduledWork.runs.retry",
    summary: "Retry a finished run",
  },
  execute: executeScheduledWorkTool,
});
