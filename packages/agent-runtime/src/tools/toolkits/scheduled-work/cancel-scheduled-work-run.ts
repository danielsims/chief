import { defineLocalTool } from "../../tool.js";
import { executeScheduledWorkTool } from "./execute.js";

export const cancelScheduledWorkRunTool = defineLocalTool({
  method: "POST",
  path: "/local-tools/scheduled-work/{scheduledWorkId}/runs/{runId}/cancel",
  operation: {
    operationId: "scheduledWork.runs.cancel",
    summary: "Cancel an active run",
  },
  execute: executeScheduledWorkTool,
});
