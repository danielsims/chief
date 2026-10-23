import { hasCapability, hasPermission } from "../types.js";
import { definePromptPart } from "./define.js";

export const scheduledTriggers = definePromptPart({
  id: "scheduled.triggers",
  summary: "Scheduled work uses one explicit trigger and one approved grant.",
  when: (ctx) =>
    hasPermission(ctx, "workspace.write") ||
    hasPermission(ctx, "schedules.manage") ||
    hasPermission(ctx, "schedules.run") ||
    hasCapability(ctx, "schedule-manager") ||
    ctx.includeAll === true,
  render:
    () => `- Save automations with recurringWork.propose; newChannel: {} creates a
  channel for the team. The user approves one before it runs, so never call
  it active until you have checked.
- Use tool steps for exact reads and writes, agent steps for judgement or
  writing, and a condition with a stop step when there may be nothing to do.
- Build an automation until it works: automations.tools, save,
  automations.test, automations.inspect, fix, repeat. Then link it with
  \`chief-desktop://navigate/automation?id=AUTOMATION_ID\`.`,
});
