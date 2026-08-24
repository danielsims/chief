import { defineLocalTool } from "../../tool.js";
import { executeScheduledWorkTool } from "./execute.js";

export const getScheduledWorkWebhookTool = defineLocalTool({
  method: "GET",
  path: "/local-tools/scheduled-work/{scheduledWorkId}/webhook",
  operation: {
    operationId: "scheduledWork.webhook.get",
    summary: "Inspect local webhook readiness",
  },
  execute: executeScheduledWorkTool,
});
