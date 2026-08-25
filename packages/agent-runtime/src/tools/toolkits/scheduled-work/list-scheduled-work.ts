import { defineLocalTool } from "../../tool.js";
import { executeScheduledWorkTool } from "./execute.js";

export const listScheduledWorkTool = defineLocalTool({
  method: "GET",
  path: "/local-tools/scheduled-work",
  operation: {
    operationId: "scheduledWork.list",
    summary: "List scheduled work",
  },
  execute: executeScheduledWorkTool,
});
