import { defineLocalTool } from "../../tool.js";
import { executeScheduledWorkTool } from "./execute.js";

export const rotateScheduledWorkWebhookTool = defineLocalTool({
  method: "POST",
  path: "/local-tools/scheduled-work/{scheduledWorkId}/webhook/rotate",
  operation: {
    operationId: "scheduledWork.webhook.rotate",
    summary: "Rotate the local webhook secret",
  },
  execute: executeScheduledWorkTool,
});
