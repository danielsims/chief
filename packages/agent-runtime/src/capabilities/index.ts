import { analyticsChartCapability } from "./analytics-chart.js";
import { campaignMemoryCapability } from "./campaign-memory.js";
import { contentCalendarCapability } from "./content-calendar.js";
import { scheduleManagerCapability } from "./schedule-manager.js";
import { trendMemoryCapability } from "./trend-memory.js";

export {
  analyticsChartCapability,
  campaignMemoryCapability,
  contentCalendarCapability,
  scheduleManagerCapability,
  trendMemoryCapability,
};
export const availableCapabilities = [
  analyticsChartCapability,
  trendMemoryCapability,
  contentCalendarCapability,
  campaignMemoryCapability,
  scheduleManagerCapability,
] as const;
export { composeAgentCapabilities, defineAgent } from "./types.js";
export type { AgentCapability } from "./types.js";
