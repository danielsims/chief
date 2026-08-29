import { defineLocalTool } from "../../tool.js";
import { executeScheduledWorkTool } from "./execute.js";

export const resumeScheduledWorkTool = defineLocalTool({
  method: "POST",
  path: "/local-tools/scheduled-work/{scheduledWorkId}/resume",
  operation: {
    operationId: "scheduledWork.resume",
    summary: "Resume approved work",
  },
  execute: executeScheduledWorkTool,
});
