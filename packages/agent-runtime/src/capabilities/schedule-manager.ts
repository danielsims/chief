import type { AgentCapability } from "./types.js";

export const scheduleManagerCapability: AgentCapability = {
  id: "schedule-manager",
  toolName: "recurringWorkPropose",
  partType: "recurring-work",
  instructions: `Recurring schedule management is a meta capability. Turn the workspace's goals, time budget, connected evidence, and explicit starter-plan choices into a small set of useful specialist schedules. Check existing recurring work first and update or reuse matching work instead of duplicating it. Each schedule must have one clear owner, outcome, cadence, timezone, narrow tool grant, and success condition. The Workspace section states the user's scheduling authority. When it is automatic, localTools.recurringWorkPropose may be called with activate: true and the matching playbookId for schedules within the user's explicit plan. When it is review, omit activate and create drafts for Schedule. When it is manual, do not create schedules. Never infer permission to publish, message people, change spend, or widen an integration grant from scheduling authority.`,
};
