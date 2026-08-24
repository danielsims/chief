import { defineLocalTool } from "../../tool.js";
import { executeScheduledWorkTool } from "./execute.js";

export const deleteScheduledWorkTool = defineLocalTool({
  method: "DELETE",
  path: "/local-tools/scheduled-work/{scheduledWorkId}",
  operation: {
    operationId: "scheduledWork.delete",
    summary: "Request permanent removal",
  },
  execute: executeScheduledWorkTool,
});
