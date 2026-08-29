import { defineLocalTool } from "../../tool.js";
import { executeScheduledWorkTool } from "./execute.js";

export const pauseScheduledWorkTool = defineLocalTool({
  method: "POST",
  path: "/local-tools/scheduled-work/{scheduledWorkId}/pause",
  operation: {
    operationId: "scheduledWork.pause",
    summary: "Pause new runs",
  },
  execute: executeScheduledWorkTool,
});
