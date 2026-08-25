import { defineLocalTool } from "../../tool.js";
import { executeScheduledWorkTool } from "./execute.js";

export const listScheduledWorkRunsTool = defineLocalTool({
  method: "GET",
  path: "/local-tools/scheduled-work/{scheduledWorkId}/runs",
  operation: {
    operationId: "scheduledWork.runs.list",
    summary: "List runs",
  },
  execute: executeScheduledWorkTool,
});
