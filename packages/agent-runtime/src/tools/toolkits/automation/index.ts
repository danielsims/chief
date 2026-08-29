import { listRecurringWorkTool } from "./list-recurring-work.js";
import { proposeRecurringWorkTool } from "./propose-recurring-work.js";

export const automationToolkit = [
  listRecurringWorkTool,
  proposeRecurringWorkTool,
] as const;
