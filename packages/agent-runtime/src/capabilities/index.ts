import { analyticsChartCapability } from "./analytics-chart.js";
import { campaignMemoryCapability } from "./campaign-memory.js";
import { contentCalendarCapability } from "./content-calendar.js";
import { prospectMemoryCapability } from "./prospect-memory.js";
import { trendMemoryCapability } from "./trend-memory.js";

export {
  analyticsChartCapability,
  campaignMemoryCapability,
  contentCalendarCapability,
  prospectMemoryCapability,
  trendMemoryCapability,
};
export const availableCapabilities = [
  analyticsChartCapability,
  prospectMemoryCapability,
  trendMemoryCapability,
  contentCalendarCapability,
  campaignMemoryCapability,
] as const;
export { composeAgentCapabilities, defineAgent } from "./types.js";
export type { AgentCapability } from "./types.js";
