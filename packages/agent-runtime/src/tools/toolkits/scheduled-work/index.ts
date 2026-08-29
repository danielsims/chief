import { cancelScheduledWorkRunTool } from "./cancel-scheduled-work-run.js";
import { createScheduledWorkTool } from "./create-scheduled-work.js";
import { deleteScheduledWorkTool } from "./delete-scheduled-work.js";
import { getScheduledWorkRunTool } from "./get-scheduled-work-run.js";
import { getScheduledWorkWebhookTool } from "./get-scheduled-work-webhook.js";
import { getScheduledWorkTool } from "./get-scheduled-work.js";
import { listScheduledWorkRunsTool } from "./list-scheduled-work-runs.js";
import { listScheduledWorkTool } from "./list-scheduled-work.js";
import { pauseScheduledWorkTool } from "./pause-scheduled-work.js";
import { resumeScheduledWorkTool } from "./resume-scheduled-work.js";
import { retryScheduledWorkRunTool } from "./retry-scheduled-work-run.js";
import { rotateScheduledWorkWebhookTool } from "./rotate-scheduled-work-webhook.js";
import { runScheduledWorkTool } from "./run-scheduled-work.js";
import { updateScheduledWorkTool } from "./update-scheduled-work.js";

export const scheduledWorkToolkit = [
  listScheduledWorkTool,
  createScheduledWorkTool,
  getScheduledWorkTool,
  updateScheduledWorkTool,
  deleteScheduledWorkTool,
  pauseScheduledWorkTool,
  resumeScheduledWorkTool,
  listScheduledWorkRunsTool,
  runScheduledWorkTool,
  getScheduledWorkRunTool,
  cancelScheduledWorkRunTool,
  retryScheduledWorkRunTool,
  getScheduledWorkWebhookTool,
  rotateScheduledWorkWebhookTool,
] as const;
