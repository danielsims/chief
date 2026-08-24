import { defineLocalTool } from "../../tool.js";
import { executeScheduledWorkTool } from "./execute.js";

export const getScheduledWorkTool = defineLocalTool({
  method: "GET",
  path: "/local-tools/scheduled-work/{scheduledWorkId}",
  operation: {
    operationId: "scheduledWork.get",
    summary: "Get scheduled work",
  },
  execute: executeScheduledWorkTool,
});
