import { defineLocalTool } from "../../tool.js";
import { executeScheduledWorkTool } from "./execute.js";

export const getScheduledWorkRunTool = defineLocalTool({
  method: "GET",
  path: "/local-tools/scheduled-work/{scheduledWorkId}/runs/{runId}",
  operation: {
    operationId: "scheduledWork.runs.get",
    summary: "Get a run",
  },
  execute: executeScheduledWorkTool,
});
