import { hasCapability, hasPermission } from "../types.js";
import { definePromptPart } from "./define.js";

export const scheduledInput = definePromptPart({
  id: "scheduled.input",
  summary:
    "Unattended scheduled work can end with a machine-readable question.",
  when: (ctx) =>
    hasPermission(ctx, "schedules.manage") ||
    hasPermission(ctx, "schedules.run") ||
    hasCapability(ctx, "schedule-manager") ||
    ctx.includeAll === true,
  render:
    () => `- In unattended scheduled work, ask a necessary business question by ending with one
  machine-readable line. Chief renders it on Overview, saves the answer to the
  workspace, and resumes this same task:
  CHIEF_INPUT_REQUEST {"id":"short-stable-id","title":"one focused question","reason":"why the answer is required","fields":[{"key":"answer","label":"Your answer","type":"multiline","save":{"contextKey":"descriptive workspace context key"}}]}
  Never use this for information that research or existing workspace context
  can answer. Credential paste fields must use secure vault destinations and
  must never enter prose or the transcript.`,
});
